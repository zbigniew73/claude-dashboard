import { Router } from 'express';
import {
  authenticateSystemUser,
  getAllowedUsers,
  issueSessionCookie,
  clearSessionCookie,
  verifySessionToken,
  SESSION_COOKIE
} from '../services/auth.js';

const router = Router();

// Podstawowy rate-limit na probach logowania (w pamieci procesu - wystarczajace
// dla panelu jednoosobowego/kilkuosobowego; przy restarcie serwera sie zeruje).
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (getAllowedUsers().length === 0) {
    return res.status(503).json({ error: 'Logowanie wylaczone - AUTH_USERS nie jest ustawiony' });
  }

  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Zbyt wiele prob logowania - sprobuj ponownie za kilka minut' });
  }

  const ok = await authenticateSystemUser(username, password);
  if (!ok) {
    return res.status(401).json({ error: 'Nieprawidlowy uzytkownik lub haslo' });
  }

  issueSessionCookie(res, username);
  res.json({ success: true, username });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.get('/status', (req, res) => {
  const authRequired = getAllowedUsers().length > 0;
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySessionToken(token) : null;
  res.json({ authRequired, username: payload?.username || null });
});

export default router;
