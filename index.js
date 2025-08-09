// index.js
const express = require('express');
const cors = require('cors');

const {
  startMonitoring,
  stopMonitoring,
  getRecentTweets,
  getStatus,
} = require('./services/twitterMonitor');

const app = express();
const PORT = process.env.PORT || 8080;

// middleware
app.use(cors());
app.use(express.json());

// health & status
app.get('/', (_req, res) => res.json({ ok: true, name: 'mememachine', ts: new Date().toISOString() }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/status', (_req, res) => res.json(getStatus()));

// tweets for frontend widget
app.get('/api/tweets/recent', (req, res) => {
  const limit = req.query.limit || 20;
  const tweets = getRecentTweets(limit);
  res.json({ ok: true, tweets });
});

// monitoring controls (what your UI buttons call)
app.post('/api/monitor/start', async (_req, res) => {
  const result = await startMonitoring();
  res.json(result);
});

app.post('/api/monitor/stop', (_req, res) => {
  const result = stopMonitoring();
  res.json(result);
});

// optional: simple mode endpoints so the UI stops showing "loading"
let CURRENT_MODE = 'paper_trading';
app.get('/api/mode', (_req, res) => res.json({ ok: true, mode: CURRENT_MODE }));
app.post('/api/mode', (req, res) => {
  const m = String(req.body?.mode || '').trim();
  if (m) CURRENT_MODE = m;
  res.json({ ok: true, mode: CURRENT_MODE });
});

// 404 handler for anything else
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not Found' }));

// boot
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  // auto-start monitoring on boot so the UI has data
  await startMonitoring();
});
