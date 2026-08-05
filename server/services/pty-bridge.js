import pty from 'node-pty';
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

    let shell;
    try {
      shell = pty.spawn('claude', buildClaudeArgs(mode, sessionId), {
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
