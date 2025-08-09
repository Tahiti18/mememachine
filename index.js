// index.js — MemesMachine API with Simulation Mode (real tweets replay), no auto-start

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

// ---------- Express setup ----------
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

const PORT = process.env.PORT || 8080;

// ---------- ENV & Config ----------
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const PRIORITY = (process.env.PRIORITY_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
const BASE = (process.env.TWITTER_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .filter(h => !PRIORITY.includes(h))
  .slice(0, Math.max(0, 5 - PRIORITY.length));

const PRIORITY_INTERVAL_MS = Math.max(60_000,  parseInt(process.env.PRIORITY_INTERVAL_MS || '60000', 10));
const BASE_INTERVAL_MS     = Math.max(600_000, parseInt(process.env.BASE_INTERVAL_MS || '600000', 10));
const PER_REQUEST_GAP_MS   = Math.max(10_000,  parseInt(process.env.PER_REQUEST_GAP_MS || '10000', 10));
const BURST_WINDOW_MS      = Math.max(300_000, parseInt(process.env.BURST_WINDOW_MS || '300000', 10));
const CREDIT_SUSPEND_THRESHOLD = Math.max(0, parseInt(process.env.CREDIT_SUSPEND_THRESHOLD || '2000', 10));
const SUSPEND_COOLDOWN_MS  = Math.max(15*60_000, parseInt(process.env.SUSPEND_COOLDOWN_MS || '1800000', 10));
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

const AI_MODE              = process.env.AI_ENSEMBLE_MODE || 'adaptive';
const ENSEMBLE_VOTING      = process.env.ENSEMBLE_VOTING || 'weighted';
const CONFIDENCE_THRESHOLD = Math.min(1, Math.max(0, parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85')));
const MODEL_PRIMARY        = process.env.PRIMARY_MODEL   || 'deepseek/deepseek-r1';
const MODEL_SECONDARY      = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const MODEL_PREMIUM        = process.env.PREMIUM_MODEL   || 'anthropic/claude-3.5-sonnet';
const MODEL_BACKUP         = process.env.BACKUP_MODEL    || 'qwen/qwen-2.5-72b-instruct';

let CURRENT_MODE = (process.env.MODE_DEFAULT || 'simulation').toLowerCase(); // default to simulation is OK

// Simulation envs
const SIM_ENABLED   = /^true$/i.test(process.env.SIMULATION_ENABLED || 'true');
const SIM_REAL      = /^true$/i.test(process.env.SIMULATION_USE_REAL_TWEETS || 'true');
const SIM_LOOKBACK  = Math.max(10, parseInt(process.env.SIMULATION_LOOKBACK_MINUTES || '120', 10)); // minutes
const SIM_MAX_PER   = Math.max(1, parseInt(process.env.SIMULATION_MAX_TWEETS_PER_CYCLE || '4', 10));
const SIM_SPEED     = Math.max(0.1, parseFloat(process.env.SIMULATION_SPEED_MULTIPLIER || '1'));   // 1 = realtime-ish
const SIM_RANDOM    = /^true$/i.test(process.env.SIMULATION_RANDOMIZE_START || 'true');

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
const lastSeenByHandle = {};
const tweetsBuffer = []; // newest-first for UI
const MAX_TWEETS = 300;

let priorityTimer = null;
let baseTimer = null;
const burstTimers = new Map();
const burstUntil = {};
let suspendedUntil = 0;
let lastPollAtPriority = null;
let lastPollAtBase = null;
let isMonitoring = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dlog  = (...a) => { if (DEBUG) console.log('[DEBUG]', ...a); };

// ---------- Simulation State ----------
let simTimer = null;
let simActive = false;
let simDataset = [];   // array of normalized tweets to replay
let simIndex = 0;

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

// ---------- Core fetch from TwitterAPI.io ----------
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
    if (st === 402) {
      suspendedUntil = Date.now() + SUSPEND_COOLDOWN_MS;
      console.warn(`⚠️ 402 for @${handle}. Suspending polling until ${new Date(suspendedUntil).toISOString()}`);
      return [];
    }
    if (st === 429) {
      console.warn(`⏳ 429 @${handle}. Backing off ${BASE_INTERVAL_MS}ms`);
      await sleep(BASE_INTERVAL_MS);
      return [];
    }
    if (st && st !== 404) {
      console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    }
    return [];
  }
}

// ---------- Burst control (live only) ----------
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
      burstUntil[handle] = Date.now() + BURST_WINDOW_MS;
    }
  }, Math.max(60_000, PRIORITY_INTERVAL_MS));

  burstTimers.set(handle, t);
  console.log(`⚡ Burst started for @${handle} (until ${new Date(burstUntil[handle]).toISOString()})`);
}

// ---------- Live poll loops ----------
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

// ---------- Simulation helpers ----------
async function buildSimulationDataset() {
  const handles = [...PRIORITY, ...BASE];
  const cutoff = Date.now() - SIM_LOOKBACK * 60_000;

  const collected = [];
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    if (!h) continue;
    if (i) await sleep(800); // tiny stagger
    try {
      const res = await twitterHttp.get('/twitter/user/last_tweets', {
        params: { userName: h, includeReplies: false },
      });
      const arr = normalizeTweets(res?.data?.tweets || [], h)
        .filter(t => new Date(t.created_at).getTime() >= cutoff);
      collected.push(...arr);
      dlog(`SIM: fetched ${arr.length} from @${h}`);
    } catch (e) {
      console.warn(`SIM: fetch failed for @${h}:`, e?.response?.status || e?.message || e);
    }
  }

  // Sort by time ascending (for replay), then optionally trim
  collected.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return collected;
}

function simIntervalMs() {
  // Base the cadence on priority interval scaled by speed
  const base = Math.max(30_000, Math.min(PRIORITY_INTERVAL_MS, 120_000)); // 30s..120s
  return Math.max(10_000, Math.floor(base / SIM_SPEED));
}

async function startSimulation() {
  if (simActive) return { ok: true, message: 'simulation already running' };
  if (!SIM_ENABLED) return { ok: false, message: 'simulation disabled by env' };

  console.log(`🎛️ Simulation starting (lookback=${SIM_LOOKBACK}m, max/cycle=${SIM_MAX_PER}, speed=${SIM_SPEED}x, randomStart=${SIM_RANDOM})`);

  if (SIM_REAL) {
    simDataset = await buildSimulationDataset();
  } else {
    simDataset = []; // If you ever want pure local data, you can inject here. We keep it empty for clarity.
  }

  if (!simDataset.length) {
    console.warn('SIM: dataset is empty (no recent tweets found within lookback).');
  }

  simIndex = SIM_RANDOM && simDataset.length ? Math.floor(Math.random() * simDataset.length) : 0;
  const tickMs = simIntervalMs();

  simTimer = setInterval(() => {
    if (!simDataset.length) return;
    const batch = [];
    for (let i = 0; i < SIM_MAX_PER; i++) {
      const t = simDataset[simIndex];
      if (!t) break;
      batch.push(t);
      simIndex = (simIndex + 1) % simDataset.length;
    }
    if (batch.length) {
      pushTweets(batch);
      const first = batch[0];
      console.log(`🎬 SIM replay: +${batch.length} (first: @${first.author} ${previewTweet(first)})`);
    }
  }, tickMs);

  simActive = true;
  return { ok: true, message: 'simulation started' };
}

function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  simActive = false;
  console.log('⏹️ Simulation stopped.');
  return { ok: true, message: 'simulation stopped' };
}

// ---------- Monitor control (manual) ----------
async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if (!TWITTER_API_KEY || (PRIORITY.length + BASE.length) === 0) {
    return { ok: false, message: 'Missing TWITTER_API_KEY or accounts' };
  }

  console.log(
    `🚀 Live monitoring started. Priority=[${PRIORITY.join(', ')||'none'}] ${PRIORITY_INTERVAL_MS}ms  ` +
    `Base=[${BASE.join(', ')||'none'}] ${BASE_INTERVAL_MS}ms  Gap=${PER_REQUEST_GAP_MS}ms  Burst=${BURST_WINDOW_MS}ms`
  );

  isMonitoring = true;
  priorityLoopOnce().catch(e => console.error('Priority init error:', e?.message || e));
  baseLoopOnce().catch(e => console.error('Base init error:', e?.message || e));

  priorityTimer = setInterval(() => priorityLoopOnce().catch(e => console.error('Priority loop error:', e?.message || e)), PRIORITY_INTERVAL_MS);
  baseTimer     = setInterval(() => baseLoopOnce().catch(e => console.error('Base loop error:', e?.message || e)), BASE_INTERVAL_MS);

  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (priorityTimer) clearInterval(priorityTimer);
  if (baseTimer) clearInterval(baseTimer);
  for (const t of burstTimers.values()) clearInterval(t);
  burstTimers.clear();
  isMonitoring = false;
  console.log('🛑 Live monitoring stopped.');
  return { ok: true, message: 'stopped' };
}

// ---------- AI helpers (real OpenRouter if key present) ----------
async function openrouterChat(model, systemPrompt, userPrompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY missing');
  }
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
    monitoring: CURRENT_MODE === 'simulation' ? simActive : isMonitoring,
    apiHealth: {
      openrouter: !!OPENROUTER_API_KEY,
      database: true,
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
    simulation: {
      enabled: SIM_ENABLED,
      active: simActive,
      lookbackMinutes: SIM_LOOKBACK,
      maxPerCycle: SIM_MAX_PER,
      speedMultiplier: SIM_SPEED,
      randomizeStart: SIM_RANDOM,
      datasetSize: simDataset.length,
      usesRealTweets: SIM_REAL,
      mode: CURRENT_MODE,
    },
  });
});

// AI info
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

// ---- Twitter/Simulation endpoints ----
app.get('/api/twitter/monitor', (_req, res) => {
  res.json({
    ok: true,
    monitoring: CURRENT_MODE === 'simulation' ? simActive : isMonitoring,
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
    recentActivity: tweetsBuffer.slice(0, 10),
    mode: CURRENT_MODE,
    simulation: { active: simActive, datasetSize: simDataset.length }
  });
});

app.get('/api/tweets/recent', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '20', 10), MAX_TWEETS));
  res.json({ tweets: tweetsBuffer.slice(0, limit) });
});

// Start/Stop depending on mode
app.post('/api/monitor/start', async (_req, res) => {
  if (CURRENT_MODE === 'simulation') {
    const out = await startSimulation();
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } else {
    const out = await startMonitoring();
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  }
});

app.post('/api/monitor/stop', (_req, res) => {
  if (CURRENT_MODE === 'simulation') {
    return res.json(stopSimulation());
  } else {
    return res.json(stopMonitoring());
  }
});

// Explicit sim control (optional)
app.get('/api/sim/status', (_req, res) => {
  res.json({ ok: true, active: simActive, datasetSize: simDataset.length, index: simIndex, mode: CURRENT_MODE });
});
app.post('/api/sim/start', async (_req, res) => res.json(await startSimulation()));
app.post('/api/sim/stop',  (_req, res) => res.json(stopSimulation()));

// Mode switch
app.post('/api/mode', (req, res) => {
  const mode = String((req.body && req.body.mode) || '').toLowerCase();
  if (!mode) return res.status(400).json({ ok: false, error: 'mode required' });
  if (!['simulation','production','paper_trading'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'invalid mode' });
  }
  // stop any running loops when switching
  if (simActive) stopSimulation();
  if (isMonitoring) stopMonitoring();
  CURRENT_MODE = mode;
  console.log(`🔀 Mode set to: ${CURRENT_MODE}`);
  res.json({ ok: true, mode: CURRENT_MODE });
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ MemesMachine API listening on ${PORT}`);
  console.log(`• Auto-start monitoring: OFF (use POST /api/monitor/start)`);
  console.log(`• Default mode: ${CURRENT_MODE}`);
  if (!TWITTER_API_KEY) console.warn('⚠️ TWITTER_API_KEY is missing — monitoring/simulation will not fetch any tweets.');
});
