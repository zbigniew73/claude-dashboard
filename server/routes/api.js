import { Router } from 'express';
import {
  initWorkspace,
  listItems,
  readItem,
  writeItem,
  deleteItem,
  readConfig,
  writeConfig,
  VALID_TYPES
} from '../services/workspace.js';
import { listCronJobs, saveCronJobs } from '../services/cron.js';
import { listCliSessions } from '../services/cli-sessions.js';

const router = Router();

function handleError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ error: error.message });
}

router.post('/workspace/init', async (req, res) => {
  try {
    const root = await initWorkspace();
    res.json({ success: true, path: root });
  } catch (error) {
    handleError(res, error);
  }
});

// Commands / Skills / Agents - wspolny CRUD na plikach .md
for (const type of VALID_TYPES) {
  router.get(`/${type}`, async (req, res) => {
    try {
      res.json(await listItems(type));
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get(`/${type}/:name`, async (req, res) => {
    try {
      const content = await readItem(type, req.params.name);
      res.json({ name: req.params.name, content });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.put(`/${type}/:name`, async (req, res) => {
    try {
      const { content } = req.body || {};
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Pole content (string) jest wymagane' });
      }
      await writeItem(type, req.params.name, content);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.delete(`/${type}/:name`, async (req, res) => {
    try {
      await deleteItem(type, req.params.name);
      res.json({ success: true });
    } catch (error) {
      handleError(res, error);
    }
  });
}

// Hooki - przechowywane w config.json, NIE wykonywane przez ten serwer.
// Claude Code sam odczytuje i wykonuje hooki wg wlasnej konfiguracji - ten panel je tylko edytuje.
router.get('/hooks', async (req, res) => {
  try {
    const config = await readConfig();
    res.json(config.hooks || { 'pre-command': [], 'post-command': [], 'on-error': [] });
  } catch (error) {
    handleError(res, error);
  }
});

router.put('/hooks', async (req, res) => {
  try {
    const config = await readConfig();
    config.hooks = req.body || {};
    await writeConfig(config);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// Cron - dziala na crontabie konta ktore uruchamia PROCES panelu (patrz README).
router.get('/cron', async (req, res) => {
  try {
    res.json(await listCronJobs());
  } catch (error) {
    handleError(res, error);
  }
});

router.put('/cron', async (req, res) => {
  try {
    const { lines } = req.body || {};
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'Pole lines (tablica stringow) jest wymagane' });
    }
    await saveCronJobs(lines);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// Lista sesji CLI - tylko metadane plikow (ID + czas), patrz komentarz
// w services/cli-sessions.js dlaczego nie parsujemy zawartosci.
router.get('/cli/sessions', async (req, res) => {
  try {
    res.json(await listCliSessions());
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
