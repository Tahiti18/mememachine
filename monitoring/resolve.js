const express = require('express');
const { resolveHandleToId } = require('../services/twitterUserResolver');

const router = express.Router();
const GAP_MS = Math.max(5500, parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10));

// Single handle: /monitoring/resolve?handle=elonmusk
router.get('/resolve', async (req, res) => {
  const handle = String(req.query.handle || '').replace(/^@/, '');
  if (!handle) return res.status(400).json({ error: 'Missing handle' });

  const id = await resolveHandleToId(handle);
  if (!id) return res.status(404).json({ error: 'Not found' });
  res.json({ handle, id });
});

// Batch: /monitoring/resolve-batch?handles=elonmusk,VitalikButerin
router.get('/resolve-batch', async (req, res) => {
  const handles = String(req.query.handles || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!handles.length) return res.status(400).json({ error: 'Missing handles' });

  const results = [];
  for (let i = 0; i < handles.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, GAP_MS)); // free-tier pacing
    const h = handles[i].replace(/^@/, '');
    const id = await resolveHandleToId(h);
    results.push({ handle: h, id });
  }
  res.json({ results });
});

module.exports = router;
