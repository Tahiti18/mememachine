// index.js — MemesMachine API (no auto-start)

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// ---- Services
// This must exist: services/twitterMonitor.js (the burst/priority version we set up)
const twitter = require('./services/twitterMonitor');

const app = express();
const PORT = process.env.PORT || 8080;

// Required for Railway/Netlify proxies so req.ip and rate-limit work correctly
app.set('trust proxy', 1);

// ---- Middlewares
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('tiny'));

// Rate limiter (safe for proxies)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120, // generous; your diagnostics hit several endpoints at once
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || 'anon',
    message: { ok: false, error: 'Too many requests, please slow down.' },
  })
);

// ---- Config helpers (for AI diagnostics)
function aiConfig() {
  return {
    mode: process.env.AI_ENSEMBLE_MODE || 'adaptive',
    voting: process.env.ENSEMBLE_VOTING || 'weighted',
    threshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85'),
    models: {
      primary: process.env.PRIMARY_MODEL || 'deepseek/deepseek-r1',
      secondary: process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku',
      premium: process.env.PREMIUM_MODEL || 'anthropic/claude-3.5-sonnet',
      backup: process.env.BACKUP_MODEL || 'qwen/qwen-2.5-72b-instruct',
    },
    hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
  };
}

// ---- Root / Health
app.get('/', (_req, res) => {
  res.type('text/plain').send('MemesMachine API online');
});

// ---- Platform status (used by dashboard)
app.get('/api/status', (_req, res) => {
  const cfg = aiConfig();
  const tStatus = twitter.getStatus ? twitter.getStatus() : { monitoring: false, priorityAccounts: [], baseAccounts: [] };

  res.json({
    status: 'online',
    monitoring: Boolean(tStatus.monitoring),
    apiHealth: {
      openrouter: cfg.hasOpenRouter,
      database: true, // set true until you wire a DB; dashboard expects a boolean
    },
    stats: {
      totalInvested: 0,
      tweetsAnalyzed: twitter.getStatus ? (twitter.getStatus().totalTweets || 0) : 0,
      tokensCreated: 0,
      successRate: 0,
    },
    twitter: {
      priority: tStatus.priorityAccounts || [],
      base: tStatus.baseAccounts || [],
      suspended: tStatus.suspended || false,
      suspendedUntil: tStatus.suspendedUntil || null,
      priorityIntervalMs: tStatus.priorityIntervalMs || null,
      baseIntervalMs: tStatus.baseIntervalMs || null,
      gapMs: tStatus.gapMs || null,
      burstWindowMs: tStatus.burstWindowMs || null,
    },
    ai: cfg,
  });
});

// ---- Twitter monitor controls & endpoints
app.get('/api/twitter/monitor', (_req, res) => {
  const s = twitter.getStatus ? twitter.getStatus() : {};
  res.json({ ok: true, ...s });
});

app.get('/api/tweets/recent', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  const tweets = twitter.getRecentTweets ? twitter.getRecentTweets(limit) : [];
  res.json({ tweets });
});

app.post('/api/monitor/start', async (_req, res) => {
  try {
    if (!twitter.startMonitoring) return res.status(500).json({ ok: false, error: 'twitterMonitor service missing' });
    const out = await twitter.startMonitoring();
    return res.json({ ok: Boolean(out?.ok), message: out?.message || 'started' });
  } catch (err) {
    console.error('monitor/start error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed to start' });
  }
});

app.post('/api/monitor/stop', (_req, res) => {
  try {
    if (!twitter.stopMonitoring) return res.status(500).json({ ok: false, error: 'twitterMonitor service missing' });
    const out = twitter.stopMonitoring();
    return res.json({ ok: Boolean(out?.ok), message: out?.message || 'stopped' });
  } catch (err) {
    console.error('monitor/stop error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'failed to stop' });
  }
});

// ---- AI service endpoints (for diagnostics)
// These are real config/status endpoints. Sentiment/analyze call OpenRouter if key is present.

app.get('/api/ai/ensemble', (_req, res) => {
  res.json({ ok: true, ...aiConfig() });
});

app.get('/api/ai/status', (_req, res) => {
  res.json({ ok: true, ...aiConfig() });
});

app.get('/api/ai/sentiment', async (req, res) => {
  const text = (req.query.text || '').toString().slice(0, 2000);
  if (!text) return res.status(400).json({ ok: false, error: 'missing text' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    // Do not fake a model call; tell the truth but keep the endpoint alive.
    return res.json({ ok: false, error: 'OPENROUTER_API_KEY not set' });
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.PRIMARY_MODEL || 'deepseek/deepseek-r1',
        messages: [
          { role: 'system', content: 'Return a JSON object with fields "score" (0-100) and "label" (NEG/NEU/POS).' },
          { role: 'user', content: `Text: ${text}\nRespond with JSON only.` }
        ],
        temperature: 0.2,
      }),
    });

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try { parsed = JSON.parse(content); } catch { /* model might return text; ignore */ }

    const score = Number(parsed.score ?? 50);
    const label = String(parsed.label ?? (score > 60 ? 'POS' : score < 40 ? 'NEG' : 'NEU'));

    res.json({ ok: true, score, label, model: data?.model || (process.env.PRIMARY_MODEL || 'deepseek/deepseek-r1') });
  } catch (err) {
    console.error('sentiment error:', err);
    res.status(502).json({ ok: false, error: err?.message || 'upstream error' });
  }
});

app.get('/api/ai/analyze', async (req, res) => {
  const text = (req.query.text || '').toString().slice(0, 4000);
  if (!text) return res.status(400).json({ ok: false, error: 'missing text' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.json({ ok: false, error: 'OPENROUTER_API_KEY not set' });

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.PREMIUM_MODEL || 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'system', content: 'Analyze the text for crypto-trading relevance. Return tight JSON with fields: "summary", "signal" (HIGH/MEDIUM/LOW), "keywords" (array).' },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
      }),
    });

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try { parsed = JSON.parse(content); } catch { parsed = { summary: content?.slice?.(0, 500) || '', signal: 'LOW', keywords: [] }; }

    res.json({ ok: true, model: data?.model || (process.env.PREMIUM_MODEL || 'anthropic/claude-3.5-sonnet'), ...parsed });
  } catch (err) {
    console.error('analyze error:', err);
    res.status(502).json({ ok: false, error: err?.message || 'upstream error' });
  }
});

// ---- Start server (NO auto-start of monitor)
app.listen(PORT, () => {
  console.log(`✅ API online on port ${PORT}`);
  console.log('ℹ️  Monitoring does NOT auto-start. Use POST /api/monitor/start or the dashboard button.');
});
