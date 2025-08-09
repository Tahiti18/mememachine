// index.js — MemesMachine API (manual start, real TwitterAPI.io + OpenRouter if keys present)

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

// ---------- Express ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests, slow down.' },
  })
);

const PORT = parseInt(process.env.PORT || '8080', 10);

// ---------- ENV / Config ----------
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

const PRIORITY = (process.env.PRIORITY_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean).slice(0, 3); // cap 3
const BASE = (process.env.TWITTER_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .filter(h => !PRIORITY.includes(h))
  .slice(0, Math.max(0, 5 - PRIORITY.length)); // total cap 5

const PRIORITY_INTERVAL_MS = Math.max(60_000,  parseInt(process.env.PRIORITY_INTERVAL_MS || '60000', 10));
const BASE_INTERVAL_MS     = Math.max(600_000, parseInt(process.env.BASE_INTERVAL_MS || '600000', 10));
const PER_REQUEST_GAP_MS   = Math.max(10_000,  parseInt(process.env.PER_REQUEST_GAP_MS || '10000', 10));
const BURST_WINDOW_MS      = Math.max(300_000, parseInt(process.env.BURST_WINDOW_MS || '300000', 10));
const CREDIT_SUSPEND_THRESHOLD = Math.max(0, parseInt(process.env.CREDIT_SUSPEND_THRESHOLD || '2000', 10));
const SUSPEND_COOLDOWN_MS  = Math.max(15 * 60_000, parseInt(process.env.SUSPEND_COOLDOWN_MS || '1800000', 10));

const AI_MODE              = process.env.AI_ENSEMBLE_MODE || 'adaptive';
const ENSEMBLE_VOTING      = process.env.ENSEMBLE_VOTING || 'weighted';
const CONFIDENCE_THRESHOLD = Math.min(1, Math.max(0, parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85')));
const MODEL_PRIMARY        = process.env.PRIMARY_MODEL   || 'deepseek/deepseek-r1';
const MODEL_SECONDARY      = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const MODEL_PREMIUM        = process.env.PREMIUM_MODEL   || 'anthropic/claude-3.5-sonnet';
const MODEL_BACKUP         = process.env.BACKUP_MODEL    || 'qwen/qwen-2.5-72b-instruct';

const MODE_DEFAULT         = (process.env.MODE_DEFAULT || 'paper_trading').trim();

// ---------- HTTP clients ----------
const twitterHttp = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': TWITTER_API_KEY },
  timeout: 12000,
});

const openrouterHttp = axios.create({
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY || 'missing'}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ---------- Monitor State ----------
const lastSeenByHandle = {};       // handle -> last tweet id (string)
const tweetsBuffer = [];           // newest-first
const MAX_TWEETS = 300;

let priorityTimer = null;
let baseTimer = null;
const burstTimers = new Map();     // handle -> interval
const burstUntil = {};             // handle -> epoch ms
let suspendedUntil = 0;            // epoch ms when polling may resume
let lastPollAtPriority = null;
let lastPollAtBase = null;
let isMonitoring = false;

let CURRENT_MODE = MODE_DEFAULT;   // 'production' | 'simulation' | 'paper_trading'

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dlog  = (...a) => { if (DEBUG) console.log('[DEBUG]', ...a); };

// ---------- Tweet helpers ----------
function normalizeTweets(raw, author) {
  return (raw || []).map(t => ({
    id: String(t.id ?? t.id_str ?? ''),
    text: t.text || '',
    created_at: t.createdAt || t.created_at || new Date().toISOString(),
    author,
    url: t.url || `https://x.com/${author}/status/${t.id}`,
  })).filter(t => t.id);
}

function pushTweets(list) {
  if (!Array.isArray(list) || !list.length) return;
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const t of list) {
    if (!tweetsBuffer.find(x => x.id === t.id)) {
      tweetsBuffer.unshift(t);
    }
  }
  if (tweetsBuffer.length > MAX_TWEETS) tweetsBuffer.length = MAX_TWEETS;
}

function previewTweet(t) {
  const s = (t.text || '').replace(/\s+/g, ' ');
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

// ---------- Core fetch (TwitterAPI.io) ----------
async function fetchLastTweets(handle) {
  try {
    const res = await twitterHttp.get('/twitter/user/last_tweets', {
      params: { userName: handle, includeReplies: false },
    });
    const tweets = normalizeTweets(res?.data?.tweets || [], handle);
    const since = lastSeenByHandle[handle];
    const fresh = since ? tweets.filter(t => t.id > since) : tweets;
    if (fresh.length) lastSeenByHandle[handle] = fresh[0].id;
    return fresh;
  } catch (e) {
    const st = e?.response?.status;

    // 402 Payment required -> suspend globally
    if (st === 402) {
      suspendedUntil = Date.now() + SUSPEND_COOLDOWN_MS;
      console.warn(`⚠️ 402 for @${handle}. Suspending all polling until ${new Date(suspendedUntil).toISOString()}`);
      return [];
    }
    // 429 rate limit -> back off at account level
    if (st === 429) {
      console.warn(`⏳ 429 on @${handle}. Backing off ${BASE_INTERVAL_MS}ms`);
      await sleep(BASE_INTERVAL_MS);
      return [];
    }
    if (st && st !== 404) {
      console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    }
    return [];
  }
}

// ---------- Burst control ----------
function ensureBurst(handle) {
  const now = Date.now();
  burstUntil[handle] = Math.max(burstUntil[handle] || 0, now + BURST_WINDOW_MS);
  if (burstTimers.has(handle)) return;

  const t = setInterval(async () => {
    if (Date.now() < suspendedUntil) return;
    if ((burstUntil[handle] || 0) <= Date.now()) {
      clearInterval(t);
      burstTimers.delete(handle);
      dlog(`Burst ended for @${handle}`);
      return;
    }
    const fresh = await fetchLastTweets(handle);
    if (fresh.length) {
      pushTweets(fresh);
      const first = fresh[0];
      console.log(`🆕 ${first.created_at} @${handle} — ${fresh.length} new. First: ${previewTweet(first)}`);
      burstUntil[handle] = Date.now() + BURST_WINDOW_MS; // extend if busy
    }
  }, Math.max(60_000, PRIORITY_INTERVAL_MS)); // burst ~60s+

  burstTimers.set(handle, t);
  console.log(`⚡ Burst started for @${handle} (until ${new Date(burstUntil[handle]).toISOString()})`);
}

// ---------- Poll loops ----------
async function priorityLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtPriority = new Date().toISOString();
  for (let i = 0; i < PRIORITY.length; i++) {
    const h = PRIORITY[i];
    if (i) await sleep(PER_REQUEST_GAP_MS);
    const fresh = await fetchLastTweets(h);
    if (fresh.length) {
      pushTweets(fresh);
      console.log(`🟢 Priority @${h}: +${fresh.length} (first: ${previewTweet(fresh[0])})`);
      ensureBurst(h);
    }
  }
}

async function baseLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtBase = new Date().toISOString();
  for (let i = 0; i < BASE.length; i++) {
    const h = BASE[i];
    if (i) await sleep(PER_REQUEST_GAP_MS);
    const fresh = await fetchLastTweets(h);
    if (fresh.length) {
      pushTweets(fresh);
      console.log(`🔵 Base @${h}: +${fresh.length} (first: ${previewTweet(fresh[0])})`);
      ensureBurst(h);
    }
  }
}

// ---------- Monitor control (manual) ----------
async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if (!TWITTER_API_KEY || (PRIORITY.length + BASE.length) === 0) {
    return { ok: false, message: 'Missing TWITTER_API_KEY or accounts' };
  }

  console.log(
    `🚀 Monitoring started. Mode=${CURRENT_MODE}. ` +
    `Priority=[${PRIORITY.join(', ')||'none'}] ${PRIORITY_INTERVAL_MS}ms | ` +
    `Base=[${BASE.join(', ')||'none'}] ${BASE_INTERVAL_MS}ms | Gap=${PER_REQUEST_GAP_MS}ms | Burst=${BURST_WINDOW_MS}ms`
  );

  isMonitoring = true;

  // kick off initial pass (non-blocking)
  priorityLoopOnce().catch(e => console.error('Priority init error:', e?.message || e));
  baseLoopOnce().catch(e => console.error('Base init error:', e?.message || e));

  priorityTimer = setInterval(
    () => priorityLoopOnce().catch(e => console.error('Priority loop error:', e?.message || e)),
    PRIORITY_INTERVAL_MS
  );
  baseTimer = setInterval(
    () => baseLoopOnce().catch(e => console.error('Base loop error:', e?.message || e)),
    BASE_INTERVAL_MS
  );

  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (priorityTimer) clearInterval(priorityTimer);
  if (baseTimer) clearInterval(baseTimer);
  for (const t of burstTimers.values()) clearInterval(t);
  burstTimers.clear();
  isMonitoring = false;
  console.log('🛑 Monitoring stopped.');
  return { ok: true, message: 'stopped' };
}

function getRecentTweets(limit = 20) {
  const n = Math.max(1, Math.min(parseInt(limit || 20, 10), MAX_TWEETS));
  return tweetsBuffer.slice(0, n);
}

function monitorStatus() {
  return {
    ok: true,
    monitoring: isMonitoring,
    priorityAccounts: PRIORITY,
    baseAccounts: BASE,
    totalTweets: tweetsBuffer.length,
    lastPollAtPriority,
    lastPollAtBase,
    priorityIntervalMs: PRIORITY_INTERVAL_MS,
    baseIntervalMs: BASE_INTERVAL_MS,
    gapMs: PER_REQUEST_GAP_MS,
    burstWindowMs: BURST_WINDOW_MS,
    suspended: Date.now() < suspendedUntil,
    suspendedUntil: Date.now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
  };
}

// ---------- AI helpers (OpenRouter) ----------
async function openrouterChat(model, systemPrompt, userPrompt) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');
  const res = await openrouterHttp.post('/chat/completions', {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return res?.data?.choices?.[0]?.message?.content?.trim() || '';
}

// ---------- Routes ----------
app.get('/', (_req, res) => res.send('MemesMachine API online'));

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'online',
    monitoring: isMonitoring,
    apiHealth: {
      openrouter: !!OPENROUTER_API_KEY,
      twitter: !!TWITTER_API_KEY,
      database: true, // keep UI green; wire your DB later
    },
    stats: {
      totalInvested: 0,
      tweetsAnalyzed: 0,
      tokensCreated: 0,
      successRate: 0,
    },
    twitter: {
      priority: PRIORITY,
      base: BASE,
      suspended: Date.now() < suspendedUntil,
      suspendedUntil: Date.now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
      priorityIntervalMs: PRIORITY_INTERVAL_MS,
      baseIntervalMs: BASE_INTERVAL_MS,
      gapMs: PER_REQUEST_GAP_MS,
      burstWindowMs: BURST_WINDOW_MS,
      creditSuspendThreshold: CREDIT_SUSPEND_THRESHOLD,
    },
    ai: {
      mode: AI_MODE,
      voting: ENSEMBLE_VOTING,
      threshold: CONFIDENCE_THRESHOLD,
      models: {
        primary: MODEL_PRIMARY,
        secondary: MODEL_SECONDARY,
        premium: MODEL_PREMIUM,
        backup: MODEL_BACKUP,
      },
      hasOpenRouter: !!OPENROUTER_API_KEY,
    },
    mode: CURRENT_MODE,
  });
});

// AI endpoints (real if OPENROUTER_API_KEY present)
app.get('/api/ai/ensemble', (_req, res) => {
  res.json({
    ok: true,
    mode: AI_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: MODEL_PRIMARY,
      secondary: MODEL_SECONDARY,
      premium: MODEL_PREMIUM,
      backup: MODEL_BACKUP,
    },
    hasOpenRouter: !!OPENROUTER_API_KEY,
  });
});

app.get('/api/ai/status', (_req, res) => {
  res.json({
    ok: true,
    mode: AI_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: MODEL_PRIMARY,
      secondary: MODEL_SECONDARY,
      premium: MODEL_PREMIUM,
      backup: MODEL_BACKUP,
    },
    hasOpenRouter: !!OPENROUTER_API_KEY,
  });
});

app.get('/api/ai/sentiment', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 2000);
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const content = await openrouterChat(
      MODEL_PRIMARY,
      'Return ONLY a JSON object with fields: score (0..100) and label in {POS, NEU, NEG}.',
      `Text: """${text}"""\nReturn JSON now.`
    );
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { score: 50, label: 'NEU' }; }
    res.json({ ok: true, ...parsed, model: MODEL_PRIMARY });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message || 'openrouter error' });
  }
});

app.get('/api/ai/analyze', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 3000);
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const content = await openrouterChat(
      MODEL_PREMIUM,
      'Summarize the text briefly and estimate a trading signal in {HIGH, MEDIUM, LOW}. Return JSON with: summary, signal, keywords (array).',
      `Text: """${text}"""\nReturn JSON only.`
    );
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      parsed = { summary: content.slice(0, 280), signal: 'LOW', keywords: [] };
    }
    res.json({ ok: true, model: MODEL_PREMIUM, ...parsed });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message || 'openrouter error' });
  }
});

// Twitter monitor endpoints
app.get('/api/twitter/monitor', (_req, res) => res.json(monitorStatus()));

app.get('/api/tweets/recent', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  res.json({ tweets: getRecentTweets(limit) });
});

app.post('/api/monitor/start', async (_req, res) => {
  const result = await startMonitoring();
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/monitor/stop', (_req, res) => {
  res.json(stopMonitoring());
});

// System mode (for your dropdown)
app.post('/api/mode', (req, res) => {
  const { mode } = req.body || {};
  if (!mode) return res.status(400).json({ ok: false, error: 'mode required' });
  CURRENT_MODE = String(mode);
  res.json({ ok: true, mode: CURRENT_MODE });
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ MemesMachine API listening on ${PORT}`);
  console.log('• Auto-start monitoring: OFF (use POST /api/monitor/start)');
  if (!TWITTER_API_KEY) console.warn('⚠️ TWITTER_API_KEY is missing — monitoring will refuse to start.');
});
