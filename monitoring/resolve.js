const express = require('express');
const { resolveHandleToId } = require('../services/twitterUserResolver');
const router = express.Router();

const GAP_MS = Math.max(5500, parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10));

router.get('/api/twitter/resolve', async (req, res) => {
  const handles = String(req.query.handles || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];
  for (let i = 0; i < handles.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, GAP_MS));
    results.push(await resolveHandleToId(handles[i]));
  }
  res.json({ results });
});

module.exports = router;
