// index.js
// MemesMachine API — real handlers only

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const twitterMonitor = require('./services/twitterMonitor'); // your real monitor (start/stop/getStatus/getRecentTweets)

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// Basic rate limit so the dashboard/diagnostics can’t spam your API
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 120 requests/minute per IP under /api
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- Root health (used by Diagnostics)
app.get('/', (_req, res) => {
  res.type('text').send('MemesMachine API online');
});

// ---------- Platform status (used by Diagnostics + UI cards)
app.get('/api/status', async (_req, res) => {
  try {
    const tw = twitterMonitor.getStatus();

    // “Real enough” health: OpenRouter available if key present, db is in-memory for now
    const apiHealth = {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      database: true, // you’re not using an external DB yet
    };

    // simple roll-up stats for the UI
    const recent = twitterMonitor.getRecentTweets(50);
    const stats = {
      totalInvested: 0,
      tweetsAnalyzed: recent.length,
      tokensCreated: 0,
      successRate: 0,
    };

    res.json({
      status: 'online',
      monitoring: tw.monitoring,
      apiHealth,
      stats,
      twitter: {
        priority: tw.priorityAccounts,
        base: tw.baseAccounts,
        lastPollAtPriority: tw.lastPollAtPriority,
        lastPollAtBase: tw.lastPollAtBase,
        suspended: tw.suspended,
        suspendedUntil: tw.suspendedUntil,
      },
    });
  } catch (err) {
    console.error('GET /api/status failed:', err);
    res.status(500).json({ ok: false, error: 'status_failed' });
  }
});

// ---------- Twitter monitor controls (REAL)
app.post('/api/monitor/start', async (_req, res) => {
  try {
    const result = await twitterMonitor.startMonitoring();
    res.json(result);
  } catch (err) {
    console.error('POST /api/monitor/start:', err?.message || err);
    res.status(500).json({ ok: false, error: 'start_failed' });
  }
});

app.post('/api/monitor/stop', (_req, res) => {
  try {
    const result = twitterMonitor.stopMonitoring();
    res.json(result);
  } catch (err) {
    console.error('POST /api/monitor/stop:', err?.message || err);
    res.status(500).json({ ok: false, error: 'stop_failed' });
  }
});

// Monitor status endpoint (your diagnostics expects this)
app.get('/api/twitter/monitor', (_req, res) => {
  try {
    const st = twitterMonitor.getStatus();
    res.json({ ok: true, ...st });
  } catch (err) {
    console.error('GET /api/twitter/monitor:', err?.message || err);
    res.status(500).json({ ok: false, error: 'monitor_status_failed' });
  }
});

// Recent tweets for the dashboard “Live Tweet Monitor”
app.get('/api/tweets/recent', (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const tweets = twitterMonitor.getRecentTweets(limit);
    // Map to UI schema (content/author/timestamp/url) w/o fake analysis
    const mapped = tweets.map(t => ({
      id: t.id,
      content: t.text,
      author: t.author,
      timestamp: t.created_at,
      url: t.url,
      analysis: t.analysis || null,
      signal: t.signal || 'PROCESSING',
    }));
    res.json({ tweets: mapped });
  } catch (err) {
    console.error('GET /api/tweets/recent:', err?.message || err);
    res.status(500).json({ ok: false, error: 'recent_failed' });
  }
});

// ---------- Error fallthrough
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

// ---------- Boot
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);

  // Optional auto-start monitoring at boot (keeps your current behavior)
  try {
    const result = await twitterMonitor.startMonitoring();
    if (!result.ok) console.warn('Auto-start monitoring skipped:', result.message || result);
  } catch (e) {
    console.error('Auto-start monitoring failed:', e?.message || e);
  }
});
