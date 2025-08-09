// index.js
'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// === Services ===
const TwitterMonitor = require('./services/twitterMonitor');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== Monitor wiring =====
const monitor = new TwitterMonitor({
  apiKey: process.env.TWITTER_API_KEY
});

const parseList = (s) =>
  (s || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

const ACCOUNTS = parseList(process.env.TWITTER_ACCOUNTS);
const PRIORITY = parseList(process.env.PRIORITY_ACCOUNTS || process.env.PRIORITY_ACCOUNT);

let systemMode = 'production';
let autoStarted = false;

async function maybeAutoStart() {
  if (autoStarted) return;
  const enabled = String(process.env.ENABLE_TWITTER_MONITORING || 'true').toLowerCase() === 'true';
  if (!enabled) return;

  try {
    const list = [...new Set([...PRIORITY, ...ACCOUNTS])];
    if (list.length) {
      await monitor.start(list);
    }
    autoStarted = true;
    console.log(`🚦 Monitoring started. Priority=${PRIORITY.join(',') || 'none'} Base=${ACCOUNTS.join(',') || 'none'}`);
  } catch (e) {
    console.error('❌ Auto-start error:', e?.message || e);
  }
}
maybeAutoStart();

// ===== Helpers for UI payloads =====
function mapTweetsForUI(items = []) {
  return items.map(t => ({
    author: t.author || 'unknown',
    content: t.text || t.content || '',
    timestamp: t.created_at || t.timestamp || new Date().toISOString(),
    analysis: t.analysis || { sentiment: 50, viral: 30, impact: 30, signal: 'PROCESSING' }
  }));
}

function computeStats() {
  const s = monitor.getStatistics ? monitor.getStatistics() : null;
  return {
    totalInvested: 0, // plug real value if you have it
    tweetsAnalyzed: s?.totalTweets ?? 0,
    tokensCreated: 0,
    successRate: s && s.totalTweets ? (s.highSignalTweets || 0) / s.totalTweets : 0
  };
}

// ===== API expected by your dashboard =====
app.get('/api/status', async (_req, res) => {
  try {
    const st = monitor.getStatus ? monitor.getStatus() : { isMonitoring: false };
    res.json({
      status: 'online',
      monitoring: !!st.isMonitoring,
      apiHealth: { openrouter: true, database: true },
      stats: computeStats()
    });
  } catch (e) {
    res.status(500).json({ error: 'status_failed', detail: String(e?.message || e) });
  }
});

app.get('/api/tweets/recent', async (_req, res) => {
  try {
    const list = await (monitor.getRecentTweets ? monitor.getRecentTweets(20) : []);
    res.json({ tweets: mapTweetsForUI(list) });
  } catch (e) {
    res.status(500).json({ error: 'tweets_failed', detail: String(e?.message || e) });
  }
});

app.post('/api/monitor/start', async (req, res) => {
  try {
    const fromBody = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    const list = parseList(fromBody.join(',')) || [...new Set([...PRIORITY, ...ACCOUNTS])];
    await monitor.start(list);
    res.json({ ok: true, monitoring: true, accounts: list });
  } catch (e) {
    res.status(500).json({ error: 'start_failed', detail: String(e?.message || e) });
  }
});

app.post('/api/mode', (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!['production', 'simulation', 'paper_trading'].includes(mode)) {
    return res.status(400).json({ error: 'bad_mode' });
  }
  systemMode = mode;
  res.json({ ok: true, mode: systemMode });
});

// health + root
app.get('/', (_req, res) => res.send('MemesMachine API online'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
