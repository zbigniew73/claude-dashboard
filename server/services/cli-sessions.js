import path from 'path';
import os from 'os';
import fs from 'fs-extra';

// Anthropic w oficjalnej dokumentacji Claude Code jawnie zaznacza, ze format
// wewnetrzny plikow transkryptu (.jsonl) zmienia sie miedzy wersjami i nie
// nalezy go parsowac bezposrednio - do budowania na danych sesji nalezy
// uzywac /export albo interfejsow skryptowych (`claude -p --resume <id>`).
// Zeby to uszanowac, NIE czytamy zawartosci plikow - tylko metadane systemu
// plikow (nazwa = ID sesji, czas modyfikacji = ostatnia aktywnosc). Dlatego
// lista sesji w tym panelu pokazuje ID + czas, a nie ludzki tytul/podsumowanie.

function getClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Claude Code mapuje katalog roboczy na nazwe projektu zamieniajac kazdy
// znak nie-alfanumeryczny na "-" (udokumentowane zachowanie).
function projectDirNameFor(workspaceDir) {
  return workspaceDir.replace(/[^a-zA-Z0-9]/g, '-');
}

function getProjectSessionsDir() {
  const workspaceDir = process.env.WORKSPACE_DIR;
  if (!workspaceDir) throw new Error('WORKSPACE_DIR nie jest ustawiony w .env');
  return path.join(getClaudeConfigDir(), 'projects', projectDirNameFor(path.resolve(workspaceDir)));
}

async function listCliSessions() {
  const dir = getProjectSessionsDir();
  if (!(await fs.pathExists(dir))) return [];

  const files = await fs.readdir(dir);
  const sessions = [];
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const id = file.replace(/\.jsonl$/, '');
    const stat = await fs.stat(path.join(dir, file));
    sessions.push({ id, updatedAt: stat.mtime });
  }
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

export { listCliSessions, getProjectSessionsDir };
