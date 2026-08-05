import pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifySessionToken, SESSION_COOKIE, isSameOrigin } from './auth.js';
import { listCliSessions } from './cli-sessions.js';

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function authenticateUpgrade(req) {
  if (!isSameOrigin(req)) return false;

  const authRequired = Boolean((process.env.AUTH_USERS || '').trim());
  if (!authRequired) return true;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  return Boolean(verifySessionToken(token));
}

function buildClaudeArgs(mode, sessionId) {
  if (mode === 'resume' && sessionId) return ['--resume', sessionId];
  return [];
}

const PANEL_ONLY_ENV = [
  'SESSION_SECRET',
  'AUTH_USERS',
  'PAM_SERVICE',
  'ALLOWED_ORIGIN',
  'EXPOSURE',
  'HOST',
  'PORT'
];

function childEnv() {
  const env = { ...process.env };
  for (const key of PANEL_ONLY_ENV) delete env[key];
  return env;
}

function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveClaudeBin() {
  const explicit = (process.env.CLAUDE_BIN || '').trim();
  if (explicit) return isExecutableFile(explicit) ? explicit : null;

  const candidates = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, 'claude'));
  candidates.push(path.join(os.homedir(), '.local', 'bin', 'claude'));

  return candidates.find(isExecutableFile) || null;
}

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

async function isKnownSessionId(sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) return false;
  try {
    const sessions = await listCliSessions();
    return sessions.some((s) => s.id === sessionId);
  } catch {
    return false;
  }
}

function attachCliWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const mode = url.searchParams.get('mode') === 'resume' ? 'resume' : 'new';
    const sessionId = url.searchParams.get('sessionId') || '';

    if (mode === 'resume' && !(await isKnownSessionId(sessionId))) {
      ws.send(JSON.stringify({ type: 'error', message: 'Nieznane ID sesji - odswiez liste sesji' }));
      ws.close();
      return;
    }
    const workspaceDir = process.env.WORKSPACE_DIR;

    if (!workspaceDir) {
      ws.send(JSON.stringify({ type: 'error', message: 'WORKSPACE_DIR nie jest ustawiony w .env' }));
      ws.close();
      return;
    }

    const claudeBin = resolveClaudeBin();
    if (!claudeBin) {
      ws.send(JSON.stringify({
        type: 'error',
        message: "Nie znaleziono programu 'claude'. Ustaw CLAUDE_BIN w .env na pelna sciezke (np. /home/user/.local/bin/claude) - pod systemd PATH nie zawiera ~/.local/bin."
      }));
      ws.close();
      return;
    }

    let shell;
    try {
      shell = pty.spawn(claudeBin, buildClaudeArgs(mode, sessionId), {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: workspaceDir,
        env: childEnv()
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: `Nie udalo sie uruchomic 'claude': ${e.message}` }));
      ws.close();
      return;
    }

    shell.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
    });
    shell.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode }));
        ws.close();
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'input') {
        shell.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols && msg.rows) {
        try {
          shell.resize(msg.cols, msg.rows);
        } catch {}
      }
    });

    ws.on('close', () => {
      try {
        shell.kill();
      } catch {}
    });
  });
}

export { attachCliWebSocket, authenticateUpgrade };
