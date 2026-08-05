import pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifySessionToken, SESSION_COOKIE } from './auth.js';

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

// Autoryzacja handshake WebSocketa - to ODDZIELNA sciezka od requireAuth
// (middleware Express dziala tylko na zwyklych requestach HTTP, nie na
// upgrade polaczenia WS), wiec sesje sprawdzamy tu recznie z tego samego
// podpisywanego ciasteczka.
function authenticateUpgrade(req) {
  const authRequired = Boolean((process.env.AUTH_USERS || '').trim());
  if (!authRequired) return true;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  return Boolean(verifySessionToken(token));
}

function buildClaudeArgs(mode, sessionId) {
  if (mode === 'resume' && sessionId) return ['--resume', sessionId];
  return []; // 'new' - zwykle `claude` startuje swiezy interaktywny sesje
}

function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// Szukamy binarki `claude` sami, zamiast liczyc na to ze execvp znajdzie ja
// w PATH. Powod: pod systemd proces dostaje minimalny PATH (bez ~/.local/bin,
// gdzie instalator Claude Code laduje domyslnie), wiec spawn konczyl sie
// surowym `execvp(3) failed.: No such file or directory` wypisanym wprost
// do terminala - blad leci w rozwidlonym procesie potomnym, wiec try/catch
// wokol pty.spawn go nie lapie. Sprawdzenie przed startem daje czytelny
// komunikat zamiast tego.
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

function attachCliWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const mode = url.searchParams.get('mode') === 'resume' ? 'resume' : 'new';
    const sessionId = url.searchParams.get('sessionId') || '';
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
        env: process.env
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
        } catch {
          // proces mogl juz sie zakonczyc - ignorujemy
        }
      }
    });

    ws.on('close', () => {
      try {
        shell.kill();
      } catch {
        // juz nie zyje - nic do zrobienia
      }
    });
  });
}

export { attachCliWebSocket, authenticateUpgrade };
