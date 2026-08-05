import { spawn } from 'child_process';

// Operujemy na crontabie konta, na ktorym dziala PROCES panelu (nie
// koniecznie tego samego, ktorym ktos sie zalogowal przez PAM - to dwie
// oddzielne tozsamosci). Patrz README, sekcja o Cron.

const CRON_LINE_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;

function readCrontabRaw() {
  return new Promise((resolve, reject) => {
    const proc = spawn('crontab', ['-l']);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      // Brak crontabu w ogole -> crontab -l konczy sie kodem != 0 i pisze
      // "no crontab for X" na stderr. To nie jest blad z naszej perspektywy.
      if (code !== 0 && !/no crontab/i.test(err)) {
        return reject(new Error(err.trim() || `crontab -l zakonczyl sie kodem ${code}`));
      }
      resolve(out);
    });
  });
}

function writeCrontabRaw(content) {
  return new Promise((resolve, reject) => {
    const proc = spawn('crontab', ['-']);
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `crontab zakonczyl sie kodem ${code}`));
      resolve();
    });
    proc.stdin.write(content);
    proc.stdin.end();
  });
}

function parseCrontab(raw) {
  return raw
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line, id) => {
      const m = line.match(CRON_LINE_RE);
      if (!m) return { id, raw: line, valid: false };
      const [, minute, hour, dom, month, dow, command] = m;
      return { id, raw: line, valid: true, minute, hour, dom, month, dow, command };
    });
}

function validateCronLine(line) {
  return CRON_LINE_RE.test(line.trim());
}

async function listCronJobs() {
  const raw = await readCrontabRaw();
  return parseCrontab(raw);
}

async function saveCronJobs(lines) {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  for (const line of cleaned) {
    if (!validateCronLine(line)) {
      const err = new Error(`Nieprawidlowa linia crontab (oczekiwano: minuta godzina dzien miesiac dzien-tyg komenda): "${line}"`);
      err.status = 400;
      throw err;
    }
  }
  const content = cleaned.length ? cleaned.join('\n') + '\n' : '';
  await writeCrontabRaw(content);
}

export { listCronJobs, saveCronJobs, validateCronLine };
