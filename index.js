// index.js
// Minimal API server wiring your twitterMonitor (function exports, not a class)

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ⬇️ use the function API you exported
const monitor = require('./services/twitterMonitor'); 
// monitor = { startMonitoring, stopMonitoring, getRecentTweets, getStatus }

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// --- Health / status
app.get('/api/status', (req, res) => {
  const m = monitor.getStatus();
  res.json({
    status: 'online',
    monitoring: m.monitoring,
    apiHealth: { openrouter: true, database: true }, // simple placeholders
    stats: {
      totalInvested: 0,
      tweetsAnalyzed: m.totalTweets,
      tokensCreated: 0,
      successRate: 0.0
    },
    monitor: m
  });
});

// --- Tweets
app.get('/api/tweets/recent', (req, res) => {
  const limit = Number(req.query.limit || 20);
  const tweets = monitor.getRecentTweets(limit).map(t => ({
    id: t.id,
    author: t.author,
    content: t.text,
    timestamp: t.created_at,
    analysis: { sentiment: 0, viral: 0, impact: 0, signal: 'PROCESSING' }
  }));
  res.json({ tweets });
});

// --- Control endpoints (used by the dashboard buttons)
app.post('/api/monitor/start', async (req, res) => {
  try {
    const result = await monitor.startMonitoring();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'start failed' });
  }
});

app.post('/api/monitor/stop', (req, res) => {
  try {
    const result = monitor.stopMonitoring();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'stop failed' });
  }
});

// --- Optional: switch modes (dashboard dropdown)
app.post('/api/mode', (req, res) => {
  const { mode } = req.body || {};
  // No-op for now, but keep endpoint so UI doesn't error
  res.json({ ok: true, mode: mode || 'production' });
});

// --- Boot
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  // Auto-start monitoring on boot if enabled
  if (String(process.env.ENABLE_TWITTER_MONITORING || 'true').toLowerCase() === 'true') {
    const r = await monitor.startMonitoring();
    console.log(`🚀 Monitoring start: ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`);
  }
});
