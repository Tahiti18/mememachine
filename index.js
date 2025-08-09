// index.js — MemesMachine API (manual start; Production + Simulation with real tweets via TwitterAPI.io)

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
const SUSPEND_COOLDOWN_MS  = Math.max(15 * 60_000, parseInt(process.env.SUSPEND_COOLDOWN_MS || '1800000', 10));

const AI_MODE              = process.env.AI_ENSEMBLE_MODE || 'adaptive';
const ENSEMBLE_VOTING      = process.env.ENSEMBLE_VOTING || 'weighted';
const CONFIDENCE_THRESHOLD = Math.min(1, Math.max(0, parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85')));
const MODEL_PRIMARY        = process.env.PRIMARY_MODEL   || 'deepseek/deepseek-r1';
const MODEL_SECONDARY      = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const MODEL_PREMIUM        = process.env.PREMIUM_MODEL   || 'anthropic/claude-3.5-sonnet';
const MODEL_BACKUP         = process.env.BACKUP_MODEL    || 'qwen/qwen-2.5-72b-instruct';

const MODE_DEFAULT         = (process.env.MODE_DEFAULT || 'paper_trading').trim(); // production | simulation | paper_trading
let CURRENT_MODE           = MODE_DEFAULT;

// --- Simulation ENV ---
const SIMULATION_ENABLED                = /^true$/i.test(process.env.SIMULATION_ENABLED || 'true');
const SIMULATION_USE_REAL_TWEETS        = /^true$/i.test(process.env.SIMULATION_USE_REAL_TWEETS || 'true');
const SIMULATION_LOOKBACK_MINUTES       = Math.max(15, parseInt(process.env.SIMULATION_LOOKBACK_MINUTES || '120', 10)); // min 15
const SIMULATION_MAX_TWEETS_PER_CYCLE   = Math.max(1, parseInt(process.env.SIMULATION_MAX_TWEETS_PER_CYCLE || '4', 10));
const SIMULATION_SPEED_MULTIPLIER       = Math.max(0.25, parseFloat(process.env.SIMULATION_SPEED_MULTIPLIER || '1')); // 1x default
const SIMULATION_RANDOMIZE_START        = /^true$/i.test(process.env.SIMULATION_RANDOMIZE_START || 'true');

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
const lastSeenByHandle = {};       // handle -> last tweet id (string) for production/paper
let lastPollAtPriority = null;
let lastPollAtBase = null;

const tweetsBuffer = [];           // newest-first (internal canonical form)
const MAX_TWEETS = 300;

let isMonitoring = false;
let suspendedUntil = 0;

let priorityTimer = null;
let baseTimer = null;

// simulation timers/state
let simTimer = null;
const simQueues = new Map();       // handle -> { queue:[tweets oldest->newest], cursor:int }
let simTickMs = 10_000;            // recalculated on start

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dlog  = (...a) => { if (DEBUG) console.log('[DEBUG]', ...a); };

// ---------- Helpers: tweets ----------
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

// ---------- TwitterAPI.io fetch (production/paper) ----------
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
    if (st === 402) { // Payment required — protect credits
      suspendedUntil = Date.now() + Math.max(SUSPEND_COOLDOWN_MS, 15 * 60_000);
      console.warn(`⚠️ 402 for @${handle}. Suspending polling until ${new Date(suspendedUntil).toISOString()}`);
      return [];
    }
    if (st === 429) { // Rate limit — soft backoff
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

// ---------- Burst control (production/paper) ----------
const burstTimers = new Map(); // handle -> interval id
const burstUntil = {};         // handle -> epoch ms

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
  }, Math.max(60_000, PRIORITY_INTERVAL_MS));

  burstTimers.set(handle, t);
  console.log(`⚡ Burst started for @${handle} (until ${new Date(burstUntil[handle]).toISOString()})`);
}

// ---------- Production/Paper loops ----------
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

// =====================================================================
//                              SIMULATION
// =====================================================================
async function buildSimulationQueues() {
  if (!SIMULATION_ENABLED) throw new Error('Simulation disabled via env');
  if (SIMULATION_USE_REAL_TWEETS && !TWITTER_API_KEY) {
    throw new Error('SIMULATION_USE_REAL_TWEETS requires TWITTER_API_KEY');
  }

  simQueues.clear();

  const allHandles = [...PRIORITY, ...BASE];
  if (allHandles.length === 0) {
    console.warn('⚠️ No accounts configured for simulation.');
    return;
  }

  console.log(`🎬 Building simulation queues for: ${allHandles.join(', ')}`);
  for (let i = 0; i < allHandles.length; i++) {
    const handle = allHandles[i];
    if (i) await sleep(Math.min(PER_REQUEST_GAP_MS, 2000)); // lighter spacing on warmup

    let tweets = [];
    if (SIMULATION_USE_REAL_TWEETS) {
      // fetch a single recent batch
      const batch = await fetchLastTweets(handle);
      tweets = batch.length ? batch : [];
    }

    // Normalize: oldest -> newest for replay order
    tweets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Optional: randomize starting point (rotate array)
    if (SIMULATION_RANDOMIZE_START && tweets.length > 3) {
      const offset = Math.floor(Math.random() * Math.min(tweets.length, 6)); // keep believable
      tweets = tweets.slice(offset).concat(tweets.slice(0, offset));
    }

    simQueues.set(handle, { queue: tweets, cursor: 0 });
    console.log(`🎞 @${handle} simulation queue ready (${tweets.length} tweets)`);
  }

  // Base tick derived from priority interval but accelerated/slowable by multiplier
  const baseTick = Math.max(3_000, Math.round(PRIORITY_INTERVAL_MS / SIMULATION_SPEED_MULTIPLIER));
  // For UI smoothness don’t exceed 30s between visible updates in sim
  simTickMs = Math.min(baseTick, 30_000);
  console.log(`⏱  Simulation tick = ${simTickMs}ms, max emits/cycle=${SIMULATION_MAX_TWEETS_PER_CYCLE}, lookback=${SIMULATION_LOOKBACK_MINUTES}m`);
}

function simulationEmitCycle() {
  if (!isMonitoring || CURRENT_MODE !== 'simulation') return;

  const handles = [...simQueues.keys()];
  if (!handles.length) return;

  let emitted = 0;
  // Round-robin across handles to keep feed varied
  for (let r = 0; r < handles.length && emitted < SIMULATION_MAX_TWEETS_PER_CYCLE; r++) {
    for (const h of handles) {
      if (emitted >= SIMULATION_MAX_TWEETS_PER_CYCLE) break;
      const st = simQueues.get(h);
      if (!st || !st.queue.length) continue;

      // roll cursor if beyond end
      if (st.cursor >= st.queue.length) st.cursor = 0;

      // Clone and re-stamp created_at to "now" to look live in feed
      const src = st.queue[st.cursor];
      st.cursor += 1;

      if (!src) continue;
      const emit = {
        ...src,
        created_at: new Date().toISOString(),
        // keep id stable; if you prefer, suffix with cursor to ensure uniqueness
        id: `${src.id}-${st.cursor}`, // avoid dedupe clashes on repeated cycles
        _simulated: true,
      };
      pushTweets([emit]);
      emitted += 1;
    }
  }

  if (emitted > 0) {
    const first = tweetsBuffer[0];
    if (first) {
      console.log(`🎧 Sim emit x${emitted} — latest: @${first.author} "${previewTweet(first)}"`);
    }
  }
}

// =====================================================================
//                       Monitor control (manual)
// =====================================================================
async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if ((PRIORITY.length + BASE.length) === 0) {
    return { ok: false, message: 'No accounts configured' };
  }

  if (CURRENT_MODE === 'simulation') {
    if (!SIMULATION_ENABLED) return { ok: false, message: 'Simulation disabled via env' };
    // setup simulation
    await buildSimulationQueues();
    isMonitoring = true;

    // clear any production timers just in case
    if (priorityTimer) clearInterval(priorityTimer);
    if (baseTimer) clearInterval(baseTimer);
    for (const t of burstTimers.values()) clearInterval(t);
    burstTimers.clear();

    // start sim timer
    if (simTimer) clearInterval(simTimer);
    simTimer = setInterval(simulationEmitCycle, simTickMs);

    console.log(`🚀 Simulation started. Mode=${CURRENT_MODE}. Accounts=[${[...simQueues.keys()].join(', ')||'none'}]`);
    return { ok: true, message: 'simulation started' };
  }

  // production / paper_trading use real polling
  if (!TWITTER_API_KEY) return { ok: false, message: 'Missing TWITTER_API_KEY' };

  isMonitoring = true;

  console.log(
    `🚀 Monitoring started. Mode=${CURRENT_MODE}. ` +
    `Priority=[${PRIORITY.join(', ')||'none'}] ${PRIORITY_INTERVAL_MS}ms | ` +
    `Base=[${BASE.join(', ')||'none'}] ${BASE_INTERVAL_MS}ms | Gap=${PER_REQUEST_GAP_MS}ms | Burst=${BURST_WINDOW_MS}ms`
  );

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

  // ensure any previous sim is off
  if (simTimer) clearInterval(simTimer);
  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (priorityTimer) clearInterval(priorityTimer);
  if (baseTimer) clearInterval(baseTimer);
  for (const t of burstTimers.values()) clearInterval(t);
  burstTimers.clear();
  if (simTimer) clearInterval(simTimer);
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
    mode: CURRENT_MODE,
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
    simulation: {
      enabled: SIMULATION_ENABLED,
      usingRealTweets: SIMULATION_USE_REAL_TWEETS,
      tickMs: simTickMs,
      maxPerCycle: SIMULATION_MAX_TWEETS_PER_CYCLE,
      speedMultiplier: SIMULATION_SPEED_MULTIPLIER,
      queues: [...simQueues.keys()],
    },
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

// AI endpoints
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

// Monitor endpoints
app.get('/api/twitter/monitor', (_req, res) => res.json(monitorStatus()));

app.get('/api/tweets/recent', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  const raw = getRecentTweets(limit);

  // Map to frontend-friendly shape: author, content, timestamp, url (+ keep analysis optional)
  const mapped = raw.map(t => ({
    id: t.id,
    author: t.author,
    content: t.text,
    timestamp: t.created_at,
    url: t.url,
    // analysis omitted intentionally; your UI handles missing safely
  }));

  res.json({ tweets: mapped });
});

app.post('/api/monitor/start', async (_req, res) => {
  const result = await startMonitoring();
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/monitor/stop', (_req, res) => {
  res.json(stopMonitoring());
});

// System mode toggle (used by your dropdown)
app.post('/api/mode', async (req, res) => {
  const { mode } = req.body || {};
  if (!mode) return res.status(400).json({ ok: false, error: 'mode required' });
  if (!['production', 'simulation', 'paper_trading'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'invalid mode' });
  }

  const wasMonitoring = isMonitoring;
  CURRENT_MODE = mode;

  // Switching modes while running: stop timers; require explicit restart (protect credits)
  if (wasMonitoring) {
    stopMonitoring();
  }
  res.json({ ok: true, mode: CURRENT_MODE, note: 'If monitoring was running, it has been stopped. Call /api/monitor/start again.' });
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ MemesMachine API listening on ${PORT}`);
  console.log('• Auto-start monitoring: OFF (use POST /api/monitor/start)');
  console.log(`• Default mode: ${CURRENT_MODE}`);
  if (!TWITTER_API_KEY) console.warn('⚠️ TWITTER_API_KEY is missing — production/paper monitoring will refuse to start.');
});
