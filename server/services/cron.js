import { spawn } from 'child_process';

// Operujemy na crontabie konta, na ktorym dziala PROCES panelu (nie
// koniecznie tego samego, ktorym ktos sie zalogowal przez PAM - to dwie
// oddzielne tozsamosci). Patrz README, sekcja o Cron.
//
// Panel NIE przepisuje crontaba. Odczyt pokazuje kazda linie bez wyjatku,
// a zapis wylacznie dopisuje na koncu - istniejaca tresc plynie dalej
// bajt w bajt i zaden kod nie jest w stanie jej zmienic ani skasowac.

const FIELD = '(?:[0-9*][0-9*/,-]*|[A-Za-z]{3}(?:-[A-Za-z]{3})?)';
const CRON_LINE_RE = new RegExp(`^(${FIELD})\\s+(${FIELD})\\s+(${FIELD})\\s+(${FIELD})\\s+(${FIELD})\\s+(.+)$`);
const SPECIAL_LINE_RE = /^(@reboot|@yearly|@annually|@monthly|@weekly|@daily|@midnight|@hourly)\s+(.+)$/;
const ENV_LINE_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;

function readCrontabRaw() {
  return new Promise((resolve, reject) => {
    const proc = spawn('crontab', ['-l']);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
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

function classifyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank' };
  if (trimmed.startsWith('#')) {
    const inner = trimmed.slice(1).trim();
    const paused = CRON_LINE_RE.test(inner) || SPECIAL_LINE_RE.test(inner);
    return { kind: 'comment', paused };
  }
  if (ENV_LINE_RE.test(trimmed)) return { kind: 'env' };

  const special = trimmed.match(SPECIAL_LINE_RE);
  if (special) return { kind: 'job', schedule: special[1], command: special[2] };

  const m = trimmed.match(CRON_LINE_RE);
  if (m) {
    const [, minute, hour, dom, month, dow, command] = m;
    return { kind: 'job', schedule: `${minute} ${hour} ${dom} ${month} ${dow}`, minute, hour, dom, month, dow, command };
  }
  return { kind: 'unknown' };
}

function parseCrontab(raw) {
  const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, id) => ({ id, raw: line, ...classifyLine(line) }));
}

function validateCronLine(line) {
  if (/[\r\n\0]/.test(line)) return false;
  const trimmed = line.trim();
  return CRON_LINE_RE.test(trimmed) || SPECIAL_LINE_RE.test(trimmed);
}

async function listCronJobs() {
  const raw = await readCrontabRaw();
  return parseCrontab(raw);
}

async function appendCronJob(line) {
  if (typeof line !== 'string' || !validateCronLine(line)) {
    const err = new Error(
      'Nieprawidlowa linia crontab. Oczekiwano "minuta godzina dzien miesiac dzien-tygodnia komenda" ' +
        'albo skrotu (@reboot, @daily, @hourly, @weekly, @monthly, @yearly).'
    );
    err.status = 400;
    throw err;
  }

  const existing = await readCrontabRaw();
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  await writeCrontabRaw(`${existing}${separator}${line.trim()}\n`);
}

export { listCronJobs, appendCronJob, validateCronLine, parseCrontab };
