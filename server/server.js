process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

import express from 'express';
import cors from 'cors';
import { sync, status, inspect, shutdown } from './scraper.js';
import { findMatches } from './matcher.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

app.get('/api/status', (_req, res) => res.json(status()));

// Re-scrape the site now (ignores cache)
app.post('/api/sync', wrap(async (_req, res) => {
  await sync(true);
  res.json(status());
}));

// Inspect headers and sample rows
app.get('/api/inspect', wrap(async (_req, res) => {
  await sync();
  res.json(inspect());
}));

// Search endpoint
app.post('/api/search', wrap(async (req, res) => {
  const names = (req.body.names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) return res.status(400).json({ error: 'No names provided.' });

  const { rows } = await sync();
  const results = names.map((query) => {
    const matches = findMatches(query, rows).map(({ row, score }) => {
      const { _tokens, ...clean } = row;
      return { ...clean, score: Number(score.toFixed(2)) };
    });
    return {
      query,
      status: matches.length === 0 ? 'not_found' : matches.length === 1 ? 'found' : 'multiple',
      matches,
    };
  });
  res.json({ ...status(), results });
}));

// Local server fallback
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API ready on http://localhost:${port}`));
}

process.on('SIGINT', async () => { await shutdown(); process.exit(0); });

// MUST be a default export of the express application instance
export default app;