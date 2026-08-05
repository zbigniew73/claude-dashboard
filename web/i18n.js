// Zeby dodac nowy jezyk: 1) skopiuj web/i18n/en.json na web/i18n/<kod>.json
// i przetlumacz wartosci, 2) dopisz <kod> do SUPPORTED_LANGS i jego nazwe do LANG_LABELS ponizej.
// Zadnych innych zmian w kodzie nie trzeba robic.
const SUPPORTED_LANGS = ['pl', 'en', 'de', 'es'];
const LANG_LABELS = { pl: 'Polski', en: 'English', de: 'Deutsch', es: 'Español' };
const LANG_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';

let currentLang = 'en';
let dict = {};
let fallbackDict = {};

function detectDefaultLang() {
  const saved = localStorage.getItem('cx-lang');
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'en';
}

async function loadLangDict(lang) {
  const res = await fetch(`/i18n/${lang}.json`);
  if (!res.ok) throw new Error(`Brak pliku tlumaczen dla jezyka: ${lang}`);
  return res.json();
}

async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
  currentLang = lang;
  localStorage.setItem('cx-lang', lang);

  if (fallbackDict.__loaded !== true) {
    fallbackDict = await loadLangDict('en');
    fallbackDict.__loaded = true;
  }
  dict = lang === 'en' ? fallbackDict : await loadLangDict(lang);

  document.documentElement.setAttribute('lang', lang);
  applyTranslations();
  if (typeof onLanguageChange === 'function') onLanguageChange();
}

function t(key, vars) {
  let str = dict[key] ?? fallbackDict[key] ?? key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    });
  }
  return str;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  renderLangSwitches();
}

function renderLangSwitches() {
  document.querySelectorAll('.lang-switch').forEach((container) => {
    const options = SUPPORTED_LANGS.map(
      (lang) => `<option value="${lang}" ${lang === currentLang ? 'selected' : ''}>${LANG_LABELS[lang]}</option>`
    ).join('');
    container.innerHTML = `<span class="icon-select-icon">${LANG_ICON}</span><select aria-label="Language">${options}</select>`;
    container.querySelector('select').onchange = (e) => setLanguage(e.target.value);
  });
}
