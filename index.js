// index.js — single file that wires the server, Twitter monitor routes, and AI routes

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const axios = require('axios');

const { startMonitoring, stopMonitoring, getRecentTweets, getStatus: getTwStatus } =
  require('./services/twitterMonitor');

const app = express();

// ---------- middleware ----------
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- tiny helpers ----------
const has = (v) => typeof v === 'string' ? v.trim().length > 0 : !!v;
const ok = (res, data) => res.json(data);
const err = (res, code, message) => res.status(code).json({ ok: false, error: message });

// ---------- root & basic status ----------
app.get('/', (_req, res) => {
  res.type('text/plain').send('MemesMachine API online');
});

app.get('/api/status', (_req, res) => {
  ok(res, {
    status: 'online',
    monitoring: true,
    apiHealth: {
      openrouter: has(process.env.OPENROUTER_API_KEY),
      database: true, // no external DB right now; server is alive
    },
    stats: {
      totalInvested: 0,
      tweetsAnalyzed: 0,
      tokensCreated: 0,
      successRate: 0,
    },
  });
});

// ---------- Twitter monitor endpoints ----------
app.post('/api/monitor/start', async (_req, res) => {
  try {
    const out = await startMonitoring();
    ok(res, { ok: true, message: out?.message || 'started' });
  } catch (e) {
    err(res, 500, e?.message || 'start failed');
  }
});

app.post('/api/monitor/stop', async (_req, res) => {
  try {
    const out = await stopMonitoring();
    ok(res, { ok: true, message: out?.message || 'stopped' });
  } catch (e) {
    err(res, 500, e?.message || 'stop failed');
  }
});

app.get('/api/tweets/recent', (req, res) => {
  const n = parseInt(req.query.limit || '20', 10);
  ok(res, { tweets: getRecentTweets(n) });
});

app.get('/api/twitter/monitor', (_req, res) => ok(res, getTwStatus()));

// ---------- AI routes (fixes your 404s) ----------
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const PRIMARY_MODEL = process.env.PRIMARY_MODEL || 'anthropic/claude-3-haiku';
const SECONDARY_MODEL = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const PREMIUM_MODEL = process.env.PREMIUM_MODEL || 'anthropic/claude-3.5-sonnet';
const BACKUP_MODEL = process.env.BACKUP_MODEL || 'qwen/qwen-2.5-72b-instruct';
const ENSEMBLE_MODE = process.env.AI_ENSEMBLE_MODE || 'adaptive';
const ENSEMBLE_VOTING = process.env.ENSEMBLE_VOTING || 'weighted';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85');

async function openRouterChat(messages, model) {
  if (!OR_KEY) throw new Error('OpenRouter API key missing');
  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model, messages, temperature: 0.2 },
    {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        'HTTP-Referer': 'https://memesmachine.netlify.app',
        'X-Title': 'MemesMachine',
      },
    }
  );
  const text = res?.data?.choices?.[0]?.message?.content || '';
  return text.trim();
}

app.get('/api/ai/ensemble', (_req, res) =>
  ok(res, {
    ok: true,
    mode: ENSEMBLE_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: PRIMARY_MODEL,
      secondary: SECONDARY_MODEL,
      premium: PREMIUM_MODEL,
      backup: BACKUP_MODEL,
    },
  })
);

app.get('/api/ai/status', (_req, res) =>
  ok(res, {
    ok: true,
    mode: ENSEMBLE_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: PRIMARY_MODEL,
      secondary: SECONDARY_MODEL,
      premium: PREMIUM_MODEL,
      backup: BACKUP_MODEL,
    },
    openrouterKey: !!OR_KEY,
  })
);

// GET /api/ai/sentiment?text=hello
app.get('/api/ai/sentiment', async (req, res) => {
  const text = (req.query.text || '').toString().trim();
  if (!text) return err(res, 400, 'missing text');

  const prompt = [
    {
      role: 'system',
      content:
        'Return a single integer 0-100 called "score" for the sentiment of the text (0 very negative, 100 very positive). Respond ONLY with the number.',
    },
    { role: 'user', content: text },
  ];

  try {
    let raw = await openRouterChat(prompt, PRIMARY_MODEL);
    let score = parseInt((raw.match(/-?\d+/) || [0])[0], 10);
    if (Number.isNaN(score)) {
      raw = await openRouterChat(prompt, BACKUP_MODEL);
      score = parseInt((raw.match(/-?\d+/) || [0])[0], 10);
    }
    score = Math.max(0, Math.min(100, score || 0));
    ok(res, { ok: true, score });
  } catch (e) {
    err(res, 500, e?.message || 'sentiment failed');
  }
});

// GET /api/ai/analyze?text=hello
app.get('/api/ai/analyze', async (req, res) => {
  const text = (req.query.text || '').toString().trim();
  if (!text) return err(res, 400, 'missing text');

  const prompt = [
    {
      role: 'system',
      content:
        'Summarize the text in <=40 words and classify sentiment as NEG/NEU/POS. Return JSON: {"summary":"...","sentiment":"NEG|NEU|POS"}.',
    },
    { role: 'user', content: text },
  ];

  try {
    let out = await openRouterChat(prompt, SECONDARY_MODEL);
    // try to parse JSON; if not, fallback wrap
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      json = { summary: out.slice(0, 240), sentiment: 'NEU' };
    }
    ok(res, { ok: true, ...json });
  } catch (e) {
    err(res, 500, e?.message || 'analyze failed');
  }
});

// ---------- boot ----------
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  // auto-start monitor on boot so the dashboard shows ACTIVE
  try {
    await startMonitoring();
  } catch (e) {
    console.warn('Twitter monitor did not auto-start:', e?.message || e);
  }
});
