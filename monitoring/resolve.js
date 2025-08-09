const express = require('express');
const {
  resolveHandleToIdWithSource,
  setHandleId,
  listMappings
} = require('../services/twitterUserResolver');

const router = express.Router();

// GET /monitoring/resolve?handle=elonmusk
router.get('/resolve', async (req, res) => {
  const handle = String(req.query.handle || '').replace(/^@/, '');
  if (!handle) return res.status(400).json({ error: 'Missing handle' });
  const { id, source } = await resolveHandleToIdWithSource(handle);
  if (!id) return res.status(404).json({ error: 'Not found', handle });
  res.json({ handle, id, source });
});

// POST /monitoring/map  body: { handle: "newhandle", id: "123456" }
router.post('/map', async (req, res) => {
  try {
    const { handle, id } = req.body || {};
    if (!handle || !id) return res.status(400).json({ error: 'Missing handle or id' });
    const out = await setHandleId(handle, id);
    res.json({ ok: true, mapped: out });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Invalid input' });
  }
});

// GET /monitoring/cache  (peek at current mappings)
router.get('/cache', (_req, res) => {
  res.json(listMappings());
});

module.exports = router;
