// /index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const TwitterMonitor = require('./services/twitterMonitor'); // your working twitterAPI.io monitor
const AI = require('./services/aiEnsemble');                 // <- file from step 1

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ---- Twitter monitor wiring
const monitor = {
  started: false,
  svc: null,
};

async function ensureMonitor() {
  if (!monitor.started) {
    monitor.svc = require('./services/twitterMonitor');
    await monitor.svc.startMonitoring();
    monitor.started = true;
  }
}

// Basic status for dashboard
app.get('/api/status', async (_req, res) => {
  try {
    const m = monitor.svc ? monitor.svc.getStatus() : { monitoring: false };
    res.json({
      status: 'online',
      monitoring: !!m?.monitoring || !!m?.isMonitoring,
      apiHealth: {
        openrouter: !!process.env.OPENROUTER_API_KEY,
        database: true
      },
      stats: {
        totalInvested: 0,
        tweetsAnalyzed: (monitor.svc?.getRecentTweets()?.length || 0),
        tokensCreated: 0,
        successRate: 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tweets endpoints
app.get('/api/tweets/recent', (_req, res) => {
  try {
    const tweets = monitor.svc?.getRecentTweets(50) || [];
    res.json({ tweets });
  } catch (e) {
    res.status(500).json({ error: e.message, tweets: [] });
  }
});

app.post('/api/monitor/start', async (_req, res) => {
  try {
    await ensureMonitor();
    res.json({ ok: true, message: 'already running' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/monitor/stop', (_req, res) => {
  try {
    if (monitor.svc) monitor.svc.stopMonitoring();
    monitor.started = false;
    res.json({ ok: true, message: 'stopped' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- REAL AI routes (no placeholders)

// health
app.get('/api/ai/status', (_req, res) => {
  try {
    res.json({ ok: true, ...AI.status() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ensemble meta (alias)
app.get('/api/ai/ensemble', (_req, res) => {
  try {
    res.json(AI.status());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// sentiment (GET: ?text=... or POST: {text})
app.get('/api/ai/sentiment', async (req, res) => {
  try {
    const text = (req.query.text || '').toString();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const result = await AI.analyzeSentiment(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/sentiment', async (req, res) => {
  try {
    const text = (req.body?.text || '').toString();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const result = await AI.analyzeSentiment(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// general analyze (POST: {content})
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const content = (req.body?.content || '').toString();
    if (!content) return res.status(400).json({ error: 'content is required' });
    const out = await AI.generalAnalyze(content);
    res.json({ analysis: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// root (optional)
app.get('/', (_req, res) => res.send('MemesMachine API online'));

// ---- boot
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  try { await ensureMonitor(); } catch (e) { console.warn('Monitor failed to start:', e.message); }
});
