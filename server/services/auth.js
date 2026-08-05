import crypto from 'crypto';
import { createRequire } from 'module';

// authenticate-pam to natywny dodatek CommonJS (jego "main" wskazuje wprost
// na plik .node) - ESM `import` tego nie obsluguje, wiec ladujemy go przez
// createRequire zamiast zwyklego `import`.
const require = createRequire(import.meta.url);
const pam = require('authenticate-pam');

const SESSION_COOKIE = 'cx_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET nie jest ustawiony lub jest za krotki (min. 32 znaki). Wygeneruj: openssl rand -hex 32'
    );
  }
  return secret;
}

function sign(payload) {
  const secret = getSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

function verify(token) {
  try {
    const secret = getSecret();
    const [data, hmac] = token.split('.');
    if (!data || !hmac) return null;

    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const expectedBuf = Buffer.from(expected);
    const hmacBuf = Buffer.from(hmac);
    if (expectedBuf.length !== hmacBuf.length || !crypto.timingSafeEqual(expectedBuf, hmacBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

function getAllowedUsers() {
  return (process.env.AUTH_USERS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

// Logowanie systemowe przez PAM (jak `login`/`sshd`) - dziala tylko dla kont
// wymienionych w AUTH_USERS. To jest CELOWA whitelist, nie tylko wygoda:
// bez niej kazdy poprawny login+haslo systemowe na serwerze dawalby dostep
// do panelu, a chcemy dopuszczac tylko konkretne, wybrane konta.
//
// WYMAGANIA PO STRONIE SYSTEMU (patrz README):
// - proces node musi byc rootem albo czlonkiem grupy `shadow` - inaczej PAM
//   (a dokladnie pomocniczy binarny unix_chkpwd) pozwoli sprawdzic TYLKO
//   haslo wlasnego uzytkownika procesu, nie dowolnego konta z whitelisty.
function authenticateSystemUser(username, password) {
  return new Promise((resolve) => {
    const allowed = getAllowedUsers();
    if (!username || !allowed.includes(username)) {
      // Odrzucamy PRZED wywolaniem PAM - whitelist nie sluzy tylko ladowi,
      // ale i temu, zeby panel nie dzialal jako oracle do zgadywania hasel
      // dowolnych kont systemowych, tylko tych jawnie dopuszczonych.
      resolve(false);
      return;
    }
    pam.authenticate(username, password || '', (err) => resolve(!err), {
      serviceName: process.env.PAM_SERVICE || 'login'
    });
  });
}

function issueSessionCookie(res, username) {
  const token = sign({ username, exp: Date.now() + SESSION_TTL_MS });
  // 'secure' (cookie tylko po HTTPS) wlaczamy jedynie w trybie world, gdzie
  // przegladarka zawsze rozmawia z Caddy po HTTPS. W trybie lan polaczenie
  // czesto jest zwyklym http:// w obrebie sieci lokalnej - tam 'secure' by
  // uniemozliwilo zapisanie ciasteczka w ogole.
  const secure = (process.env.EXPOSURE || 'local') === 'world';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function verifySessionToken(token) {
  return verify(token);
}

// UWAGA: ta funkcja NIE zgaduje "czy to lokalne polaczenie" na podstawie req.ip.
// Za reverse proxy (tryb world) kazde polaczenie - takze z internetu - dociera
// do node'a jako 127.0.0.1, wiec taka heurystyka bylaby dziurawa. Decyzja "czy
// w ogole wymagac logowania" zapada raz, przy starcie serwera (patrz index.js),
// na podstawie jawnego EXPOSURE, a nie per-request.
function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Brak sesji - zaloguj sie' });

  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'Sesja wygasla lub nieprawidlowa - zaloguj sie ponownie' });

  req.user = payload.username;
  next();
}

export {
  authenticateSystemUser,
  getAllowedUsers,
  issueSessionCookie,
  clearSessionCookie,
  verifySessionToken,
  requireAuth,
  SESSION_COOKIE
};
