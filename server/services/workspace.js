import path from 'path';
import fs from 'fs-extra';

const VALID_TYPES = ['tasks', 'commands', 'skills', 'agents'];

const EXAMPLE_TASK_NAME = 'przyklad-filtr-cen';
const EXAMPLE_TASK_CONTENT = `# Wdrozenie: filtr cen w sklepie example.com

Status: in-progress

## Cel
Dodac filtr zakresu cen na stronie kategorii, zeby klienci mogli szybciej
zawezic wybor produktow do swojego budzetu.

## Kontekst
- Sklep e-commerce, motyw customowy
- Filtr ma dzialac bez przeladowania strony (AJAX)
- Musi respektowac istniejacy layout filtrow (marka, kolor, rozmiar)

## Kroki
- [ ] Sprawdzic czy platforma ma gotowy widget zakresu cen pasujacy do layoutu
- [ ] Dodac slider zakresu cen do sidebar filtrow
- [ ] Podpiac AJAX odswiezanie listy produktow po zmianie zakresu
- [ ] Przetestowac na urzadzeniach mobilnych
- [ ] Sprawdzic wplyw na czas ladowania strony (Core Web Vitals)

## Kryteria akceptacji
- Filtr dziala bez przeladowania strony
- Dziala poprawnie na mobile i desktop
- Nie spowalnia LCP powyzej obecnego wyniku

## Notatki
To jest przykladowe zadanie pokazujace szkielet. Usun je albo edytuj,
kiedy zaczniesz dodawac wlasne.
`;

function getWorkspaceRoot() {
  const dir = process.env.WORKSPACE_DIR;
  if (!dir) throw new Error('WORKSPACE_DIR nie jest ustawiony w .env');
  return path.resolve(dir, '.claude');
}

function safeTypeDir(type) {
  if (!VALID_TYPES.includes(type)) {
    const err = new Error(`Nieprawidlowy typ: ${type}`);
    err.status = 400;
    throw err;
  }
  return path.join(getWorkspaceRoot(), type);
}

const SAFE_FILENAME_RE = /^(?!\.)[\p{L}\p{N}._ -]{1,100}$/u;

function safeFilePath(baseDir, filename) {
  if (!filename || !SAFE_FILENAME_RE.test(filename) || filename.includes('..')) {
    const err = new Error(
      'Nieprawidlowa nazwa pliku - dozwolone sa litery, cyfry, spacja oraz . _ - (max 100 znakow)'
    );
    err.status = 400;
    throw err;
  }
  const filePath = path.join(baseDir, `${filename}.md`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }
  return resolved;
}

async function initWorkspace() {
  const root = getWorkspaceRoot();
  for (const type of VALID_TYPES) {
    await fs.ensureDir(path.join(root, type));
  }
  const tasksDir = path.join(root, 'tasks');
  const existingTasks = (await fs.readdir(tasksDir)).filter((f) => f.endsWith('.md'));
  if (existingTasks.length === 0) {
    await fs.writeFile(path.join(tasksDir, `${EXAMPLE_TASK_NAME}.md`), EXAMPLE_TASK_CONTENT, 'utf-8');
  }

  return root;
}

async function listItems(type) {
  const dir = safeTypeDir(type);
  await fs.ensureDir(dir);
  const files = await fs.readdir(dir);
  const items = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const name = file.replace(/\.md$/, '');
    const stat = await fs.stat(path.join(dir, file));
    const item = { name, updatedAt: stat.mtime };
    if (type === 'tasks') {
      const content = await fs.readFile(path.join(dir, file), 'utf-8');
      const match = content.match(/^Status:\s*(.+)$/m);
      item.status = match ? match[1].trim() : null;
    }
    items.push(item);
  }
  return items;
}

async function readItem(type, name) {
  const dir = safeTypeDir(type);
  const filePath = safeFilePath(dir, name);
  if (!(await fs.pathExists(filePath))) {
    const err = new Error('Nie znaleziono');
    err.status = 404;
    throw err;
  }
  return fs.readFile(filePath, 'utf-8');
}

async function writeItem(type, name, content) {
  const dir = safeTypeDir(type);
  await fs.ensureDir(dir);
  const filePath = safeFilePath(dir, name);
  await fs.writeFile(filePath, content, 'utf-8');
}

async function deleteItem(type, name) {
  const dir = safeTypeDir(type);
  const filePath = safeFilePath(dir, name);
  await fs.remove(filePath);
}

// Hooki czytamy z settings.json / settings.local.json, bo TAM szuka ich
// Claude Code. Panel ich nie zapisuje - to jego zywy plik konfiguracyjny,
// a bledny zapis popsulby uzytkownikowi codzienne srodowisko pracy.
const SETTINGS_FILES = ['settings.json', 'settings.local.json'];

async function readHooks() {
  const root = getWorkspaceRoot();
  const rows = [];

  for (const file of SETTINGS_FILES) {
    const filePath = path.join(root, file);
    if (!(await fs.pathExists(filePath))) continue;

    let data;
    try {
      data = await fs.readJson(filePath);
    } catch {
      rows.push({ source: file, event: null, matcher: null, command: null, unreadable: true });
      continue;
    }

    const hooks = data && typeof data.hooks === 'object' ? data.hooks : null;
    if (!hooks) continue;

    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const matcher = entry && typeof entry.matcher === 'string' ? entry.matcher : null;
        const list = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
        for (const hook of list) {
          rows.push({
            source: file,
            event,
            matcher,
            type: hook && hook.type ? String(hook.type) : null,
            command: hook && hook.command ? String(hook.command) : ''
          });
        }
      }
    }
  }

  return rows;
}

export { initWorkspace, listItems, readItem, writeItem, deleteItem, readHooks, VALID_TYPES };
