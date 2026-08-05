import { Router } from 'express';
import {
  initWorkspace,
  listItems,
  readItem,
  writeItem,
  deleteItem,
  readHooks,
  VALID_TYPES
} from '../services/workspace.js';
import { listCronJobs, appendCronJob } from '../services/cron.js';
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

router.get('/hooks', async (req, res) => {
  try {
    res.json(await readHooks());
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/cron', async (req, res) => {
  try {
    res.json(await listCronJobs());
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/cron', async (req, res) => {
  try {
    const { line } = req.body || {};
    if (typeof line !== 'string' || !line.trim()) {
      return res.status(400).json({ error: 'Pole line (niepusty string) jest wymagane' });
    }
    await appendCronJob(line);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.get('/cli/sessions', async (req, res) => {
  try {
    res.json(await listCliSessions());
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
