import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import http from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import { requireAuth, getAllowedUsers, isSameOrigin } from './services/auth.js';
import { attachCliWebSocket, authenticateUpgrade } from './services/pty-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '4200', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const EXPOSURE = process.env.EXPOSURE || 'local'; // local | lan | world

const isLoopbackHost = HOST === '127.0.0.1' || HOST === 'localhost';

if (!['local', 'lan', 'world'].includes(EXPOSURE)) {
  console.error(`\n[BLAD] EXPOSURE musi byc "local", "lan" albo "world" (jest: "${EXPOSURE}")\n`);
  process.exit(1);
}

if (EXPOSURE === 'local' && !isLoopbackHost) {
  console.error(
    `\n[BLAD] EXPOSURE=local wymaga HOST=127.0.0.1 (jest: "${HOST}").\n` +
    'Jesli chcesz dostep z sieci lokalnej, ustaw EXPOSURE=lan.\n'
  );
  process.exit(1);
}

if (EXPOSURE === 'lan' && isLoopbackHost) {
  console.error(
    '\n[BLAD] EXPOSURE=lan wymaga realnego adresu w Twojej sieci lokalnej jako HOST\n' +
    '(np. 192.168.1.100), nie 127.0.0.1. Sprawdz: `ip addr` / `hostname -I`.\n'
  );
  process.exit(1);
}

if (EXPOSURE === 'world' && !isLoopbackHost) {
  console.error(
    '\n[BLAD] EXPOSURE=world wymaga HOST=127.0.0.1 - node ma nasluchiwac WYLACZNIE\n' +
    'lokalnie, a ruch z internetu ma przychodzic przez Caddy (reverse proxy + TLS).\n' +
    'Nigdy nie wystawiaj node\'a bezposrednio pod publiczny adres.\n'
  );
  process.exit(1);
}

const allowedUsers = getAllowedUsers();

const authRequired = EXPOSURE !== 'local' || allowedUsers.length > 0;

if (authRequired) {
  if (allowedUsers.length === 0) {
    console.error(
      `\n[BLAD] EXPOSURE=${EXPOSURE} wymaga ustawienia AUTH_USERS w .env (lista kont systemowych\n` +
      'oddzielonych przecinkiem, np. AUTH_USERS=zibi,drugi_user).\n' +
      'Bez tego kazdy kto trafi na ten adres/domene mialby pelny dostep bez logowania.\n'
    );
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('\n[BLAD] SESSION_SECRET nie jest ustawiony lub jest za krotki (min. 32 znaki).');
    console.error('Wygeneruj: openssl rand -hex 32\n');
    process.exit(1);
  }
}

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGIN || false,
    credentials: true
  })
);

if (EXPOSURE === 'world') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'Zadanie z obcego originu zostalo odrzucone' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api', authRequired ? requireAuth : (req, res, next) => next(), apiRoutes);

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'"
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const XTERM_FILES = {
  '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js'
};
for (const [route, modulePath] of Object.entries(XTERM_FILES)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, '../node_modules', modulePath));
  });
}

app.use(express.static(path.join(__dirname, '../web')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
attachCliWebSocket(wss);

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws/cli') {
    socket.destroy();
    return;
  }
  if (!authenticateUpgrade(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  const modeLabel = { local: 'LOCAL (tylko ta maszyna)', lan: 'LAN (Twoja siec lokalna)', world: 'WORLD (za Caddy, z internetu)' }[EXPOSURE];
  console.log(`\nClaude Dashboard dziala na http://${HOST}:${PORT}`);
  console.log(`Workspace: ${process.env.WORKSPACE_DIR || '(nie ustawiono WORKSPACE_DIR w .env)'}`);
  console.log(`Tryb: ${modeLabel}`);
  console.log(
    authRequired
      ? `Autoryzacja: WLACZONA (konta systemowe: ${allowedUsers.join(', ')})`
      : 'Autoryzacja: WYLACZONA (dostep tylko z tej maszyny)'
  );
  if (EXPOSURE === 'world') {
    console.log('Upewnij sie, ze Caddy proxyuje do tego adresu i port nie jest otwarty bezposrednio na firewallu.');
  }
  console.log('');
});
