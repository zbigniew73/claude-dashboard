const API = '/api';
let currentTab = 'tasks';
let currentItem = null;

async function api(method, url, body) {
const res = await fetch(API + url, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
  credentials: 'include'
});
if (res.status === 401 || res.status === 503) {
  showLogin(res.status === 503 ? '' : t('login.error_session_expired'));
  throw new Error('unauthorized');
}
const data = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(data.error || res.statusText);
return data;
}

const THEME_ICONS = {
light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
};

function applyTheme(theme) {
document.documentElement.setAttribute('data-theme', theme);
localStorage.setItem('cx-theme', theme);
renderThemeSwitches();
}

function renderThemeSwitches() {
const current = localStorage.getItem('cx-theme') || 'system';
document.querySelectorAll('.theme-switch').forEach((container) => {
  const options = ['light', 'dark', 'system']
    .map((theme) => `<option value="${theme}" ${theme === current ? 'selected' : ''}>${t('theme.' + theme)}</option>`)
    .join('');
  container.innerHTML = `<span class="icon-select-icon">${THEME_ICONS[current]}</span><select aria-label="${t('theme.' + current)}">${options}</select>`;
  container.querySelector('select').onchange = (e) => applyTheme(e.target.value);
});
}

function showLogin(msg) {
document.getElementById('login-screen').style.display = 'flex';
document.getElementById('app').style.display = 'none';
document.getElementById('login-error').textContent = msg || '';
}

function showApp(username) {
document.getElementById('login-screen').style.display = 'none';
document.getElementById('app').style.display = 'flex';
if (username) document.getElementById('current-user').textContent = username;
renderTab();
loadCliSessionsList();
}

document.getElementById('login-btn').onclick = async () => {
const username = document.getElementById('username-input').value;
const password = document.getElementById('password-input').value;
try {
  const result = await api('POST', '/auth/login', { username, password });
  showApp(result.username);
} catch (e) {
  document.getElementById('login-error').textContent = t('login.error_wrong_password');
}
};
document.getElementById('username-input').addEventListener('keydown', (e) => {
if (e.key === 'Enter') document.getElementById('password-input').focus();
});
document.getElementById('password-input').addEventListener('keydown', (e) => {
if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('logout-btn').onclick = async () => {
closeCliConnection();
await api('POST', '/auth/logout');
showLogin();
};

document.querySelectorAll('nav .tab').forEach((btn) => {
btn.onclick = () => {
  document.querySelectorAll('nav .tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('nav .cli-session-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  closeCliConnection();
  currentTab = btn.dataset.tab;
  currentItem = null;
  renderTab();
};
});

async function renderTab() {
const content = document.getElementById('content');
if (currentTab === 'hooks') {
  content.innerHTML = `<div class="hooks-editor" id="hooks-editor">${t('hooks.loading')}</div>`;
  await renderHooks();
  return;
}
if (currentTab === 'cron') {
  content.innerHTML = `<div class="cron-editor" id="cron-editor">${t('hooks.loading')}</div>`;
  await renderCron();
  return;
}
if (currentTab === 'cli') {
  return;
}
content.innerHTML = `
  <div class="list-pane">
    <button class="new-item secondary" id="new-item-btn" data-i18n="list.new"></button>
    <div id="item-list"></div>
  </div>
  <div class="editor-pane" id="editor-pane">
    <div class="empty-state" data-i18n="list.select_or_create"></div>
  </div>
`;
applyTranslations();
document.getElementById('new-item-btn').onclick = createNewItem;
await loadList();
}

function normalizeStatus(raw) {
const s = raw.trim().toLowerCase();
const done = ['done', 'gotowe', 'zrobione', 'complete', 'completed', 'erledigt', 'fertig', 'hecho'];
const inProgress = ['in-progress', 'in progress', 'w trakcie', 'in arbeit', 'en curso', 'en progreso'];
if (done.includes(s)) return 'done';
if (inProgress.includes(s)) return 'in-progress';
return 'todo';
}

async function loadList() {
const items = await api('GET', `/${currentTab}`);
const listEl = document.getElementById('item-list');
listEl.innerHTML = items
  .map((it) => {
    let badge = '';
    if (it.status) {
      const canonical = normalizeStatus(it.status);
      const label = t('status.' + canonical.replace('-', '_'));
      badge = ` <span class="status-badge status-${canonical}">${escapeHtml(label)}</span>`;
    }
    const safeName = escapeHtml(it.name);
    return `<div class="item" data-name="${safeName}">${safeName}${badge}</div>`;
  })
  .join('') || `<div class="empty-state" style="padding:10px;font-size:12px;">${t('list.empty')}</div>`;

listEl.querySelectorAll('.item').forEach((el) => {
  el.onclick = () => openItem(el.dataset.name);
});
}

function taskTemplate(name) {
return `# ${name}\n\nStatus: todo\n\n## ${t('template.goal')}\n\n\n## ${t('template.context')}\n\n\n## ${t('template.steps')}\n- [ ] \n- [ ] \n- [ ] \n\n## ${t('template.acceptance_criteria')}\n- \n`;
}

const NEW_ITEM_TEMPLATES = {
tasks: taskTemplate,
commands: (name) => `# ${name}\n\n`,
skills: (name) => `# ${name}\n\n`,
agents: (name) => `# ${name}\n\n`
};

async function createNewItem() {
const name = prompt(t('prompt.new_name'));
if (!name) return;
try {
  const content = (NEW_ITEM_TEMPLATES[currentTab] || ((n) => `# ${n}\n\n`))(name);
  await api('PUT', `/${currentTab}/${encodeURIComponent(name)}`, { content });
  await loadList();
  openItem(name);
} catch (e) {
  alert(t('error.prefix') + e.message);
}
}

async function openItem(name) {
currentItem = name;
document.querySelectorAll('.list-pane .item').forEach((el) => {
  el.classList.toggle('active', el.dataset.name === name);
});
const { content } = await api('GET', `/${currentTab}/${encodeURIComponent(name)}`);
const pane = document.getElementById('editor-pane');
pane.innerHTML = `
  <div class="toolbar">
    <strong style="font-family:var(--mono);font-size:13px;">${escapeHtml(name)}.md</strong>
    <span style="flex:1;"></span>
    <button id="save-btn" data-i18n="editor.save"></button>
    <button class="danger" id="delete-btn" data-i18n="editor.delete"></button>
  </div>
  <textarea id="editor-textarea">${escapeHtml(content)}</textarea>
`;
applyTranslations();
document.getElementById('save-btn').onclick = async () => {
  const value = document.getElementById('editor-textarea').value;
  await api('PUT', `/${currentTab}/${encodeURIComponent(name)}`, { content: value });
};
document.getElementById('delete-btn').onclick = async () => {
  if (!confirm(t('editor.confirm_delete', { name }))) return;
  await api('DELETE', `/${currentTab}/${encodeURIComponent(name)}`);
  currentItem = null;
  await loadList();
  document.getElementById('editor-pane').innerHTML = `<div class="empty-state">${t('list.select_or_create')}</div>`;
};
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(str) {
return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

async function renderHooks() {
const hooks = await api('GET', '/hooks');
const el = document.getElementById('hooks-editor');
const groups = ['pre-command', 'post-command', 'on-error'];
const labelKeys = { 'pre-command': 'hooks.pre_command', 'post-command': 'hooks.post_command', 'on-error': 'hooks.on_error' };

el.innerHTML = groups
  .map(
    (g) => `
  <div class="hook-group" data-group="${g}">
    <h3>${t(labelKeys[g])}</h3>
    <div class="hook-rows"></div>
    <button class="secondary add-hook-btn" data-group="${g}">${t('hooks.add')}</button>
  </div>`
  )
  .join('') + `<button id="save-hooks-btn">${t('hooks.save')}</button>`;

groups.forEach((g) => renderHookRows(g, hooks[g] || []));

el.querySelectorAll('.add-hook-btn').forEach((btn) => {
  btn.onclick = () => {
    const g = btn.dataset.group;
    const rows = getHookValues(g);
    rows.push('');
    renderHookRows(g, rows);
  };
});

document.getElementById('save-hooks-btn').onclick = async () => {
  const payload = {};
  groups.forEach((g) => (payload[g] = getHookValues(g).filter((v) => v.trim())));
  await api('PUT', '/hooks', payload);
  alert(t('hooks.saved'));
};
}

function renderHookRows(group, values) {
const container = document.querySelector(`.hook-group[data-group="${group}"] .hook-rows`);
container.innerHTML = values
  .map(
    (v, i) => `
  <div class="hook-row">
    <input type="text" value="${escapeHtml(v)}" data-idx="${i}">
    <button class="danger remove-hook-btn" data-idx="${i}">x</button>
  </div>`
  )
  .join('');
container.querySelectorAll('.remove-hook-btn').forEach((btn) => {
  btn.onclick = () => {
    const idx = parseInt(btn.dataset.idx, 10);
    const rows = getHookValues(group);
    rows.splice(idx, 1);
    renderHookRows(group, rows);
  };
});
}

function getHookValues(group) {
const inputs = document.querySelectorAll(`.hook-group[data-group="${group}"] input`);
return Array.from(inputs).map((i) => i.value);
}

async function renderCron() {
const jobs = await api('GET', '/cron');
const el = document.getElementById('cron-editor');
el.innerHTML = `
  <div class="cron-help" data-i18n="cron.help"></div>
  <div id="cron-rows"></div>
  <div style="display:flex;gap:8px;margin-top:10px;">
    <button class="secondary" id="add-cron-btn" data-i18n="cron.add"></button>
    <button id="save-cron-btn" data-i18n="cron.save"></button>
  </div>
`;
applyTranslations();
renderCronRows(jobs.map((j) => j.raw));

document.getElementById('add-cron-btn').onclick = () => {
  renderCronRows([...getCronValues(), '']);
};
document.getElementById('save-cron-btn').onclick = async () => {
  try {
    await api('PUT', '/cron', { lines: getCronValues() });
    alert(t('hooks.saved'));
  } catch (e) {
    alert(t('error.prefix') + e.message);
  }
};
}

function renderCronRows(values) {
const container = document.getElementById('cron-rows');
container.innerHTML = values
  .map(
    (v, i) => `
  <div class="cron-row">
    <input type="text" value="${escapeHtml(v)}" data-idx="${i}" data-i18n-placeholder="cron.line_placeholder">
    <button class="danger remove-cron-btn" data-idx="${i}">x</button>
  </div>`
  )
  .join('');
applyTranslations();
container.querySelectorAll('.remove-cron-btn').forEach((btn) => {
  btn.onclick = () => {
    const idx = parseInt(btn.dataset.idx, 10);
    const rows = getCronValues();
    rows.splice(idx, 1);
    renderCronRows(rows);
  };
});
}

function getCronValues() {
const inputs = document.querySelectorAll('#cron-rows input');
return Array.from(inputs).map((i) => i.value);
}

let cliSocket = null;
let cliTerm = null;
let cliFitAddon = null;
let cliResizeHandler = null;

function closeCliConnection() {
if (cliSocket) {
  try { cliSocket.close(); } catch {}
  cliSocket = null;
}
if (cliResizeHandler) {
  window.removeEventListener('resize', cliResizeHandler);
  cliResizeHandler = null;
}
if (cliTerm) {
  cliTerm.dispose();
  cliTerm = null;
}
cliFitAddon = null;
}

async function loadCliSessionsList() {
try {
  const sessions = await api('GET', '/cli/sessions');
  const el = document.getElementById('cli-sessions-list');
  if (sessions.length === 0) {
    el.innerHTML = `<div class="cli-empty" data-i18n="cli.no_sessions"></div>`;
    applyTranslations();
    return;
  }
  el.innerHTML = sessions
    .map(
      (s) => `
    <div class="cli-session-item" data-session-id="${escapeHtml(s.id)}" title="${escapeHtml(s.id)}">
      ${escapeHtml(s.id)}
      <span class="session-time">${new Date(s.updatedAt).toLocaleString()}</span>
    </div>`
    )
    .join('');
  el.querySelectorAll('.cli-session-item').forEach((item) => {
    item.onclick = () => {
      document.querySelectorAll('nav .tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('nav .cli-session-item').forEach((b) => b.classList.remove('active'));
      item.classList.add('active');
      openCli('resume', item.dataset.sessionId);
    };
  });
} catch {
}
}

document.getElementById('new-chat-btn').onclick = () => {
document.querySelectorAll('nav .tab').forEach((b) => b.classList.remove('active'));
document.querySelectorAll('nav .cli-session-item').forEach((b) => b.classList.remove('active'));
openCli('new', null);
};

function openCli(mode, sessionId) {
closeCliConnection();
currentTab = 'cli';
currentItem = null;

const content = document.getElementById('content');
content.innerHTML = `
  <div class="cli-pane">
    <div class="cli-terminal" id="cli-terminal"></div>
    <div class="cli-status" id="cli-status">${t('cli.connecting')}</div>
  </div>
`;

cliTerm = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
  theme: { background: '#0f1115', foreground: '#e6e8eb' }
});
cliFitAddon = new FitAddon.FitAddon();
cliTerm.loadAddon(cliFitAddon);
cliTerm.open(document.getElementById('cli-terminal'));
cliFitAddon.fit();

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const params = new URLSearchParams({ mode });
if (sessionId) params.set('sessionId', sessionId);
cliSocket = new WebSocket(`${protocol}//${location.host}/ws/cli?${params.toString()}`);

const statusEl = document.getElementById('cli-status');

cliSocket.onopen = () => {
  statusEl.textContent = t('cli.connected');
  cliFitAddon.fit();
  cliSocket.send(JSON.stringify({ type: 'resize', cols: cliTerm.cols, rows: cliTerm.rows }));
};
cliSocket.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'data') cliTerm.write(msg.data);
  if (msg.type === 'error') {
    statusEl.textContent = t('error.prefix') + msg.message;
  }
  if (msg.type === 'exit') {
    statusEl.textContent = t('cli.disconnected') + (msg.exitCode !== undefined ? ` (kod ${msg.exitCode})` : '');
    loadCliSessionsList();
  }
};
cliSocket.onclose = () => {
  if (statusEl) statusEl.textContent = t('cli.disconnected');
};
cliSocket.onerror = () => {
  if (statusEl) statusEl.textContent = t('cli.disconnected');
};

cliTerm.onData((data) => {
  if (cliSocket && cliSocket.readyState === WebSocket.OPEN) {
    cliSocket.send(JSON.stringify({ type: 'input', data }));
  }
});

cliResizeHandler = () => {
  if (!cliFitAddon || !cliTerm) return;
  cliFitAddon.fit();
  if (cliSocket && cliSocket.readyState === WebSocket.OPEN) {
    cliSocket.send(JSON.stringify({ type: 'resize', cols: cliTerm.cols, rows: cliTerm.rows }));
  }
};
window.addEventListener('resize', cliResizeHandler);
}

function onLanguageChange() {
renderThemeSwitches();
const app = document.getElementById('app');
if (app && app.style.display !== 'none' && currentTab !== 'cli') {
  renderTab();
}
}

(async () => {
await setLanguage(detectDefaultLang());
try {
  const status = await fetch(API + '/auth/status').then((r) => r.json());
  if (!status.authRequired) {
    showApp();
    return;
  }
  await api('GET', '/commands');
  showApp(status.username);
} catch {
  showLogin();
}
})();
