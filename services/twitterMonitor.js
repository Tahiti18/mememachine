// services/twitterMonitor.js
// TwitterAPI.io monitor with Priority/Base tiers, Burst-on-Activity, Credit Guard, Quiet logs.

const axios = require('axios');

// ---- ENV (with guardrails)
const API_KEY = process.env.TWITTER_API_KEY || '';

const PRIORITY = (process.env.PRIORITY_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean).slice(0, 3); // cap: 3
const BASE = (process.env.TWITTER_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .filter(h => !PRIORITY.includes(h)).slice(0, 5 - PRIORITY.length); // total cap: 5

// intervals (ms)
const PRIORITY_INTERVAL = Math.max(60_000, parseInt(process.env.PRIORITY_INTERVAL_MS || '60000', 10)); // >= 60s
const BASE_INTERVAL     = Math.max(600_000, parseInt(process.env.BASE_INTERVAL_MS || '600000', 10));   // >= 10m
const GAP_MS            = Math.max(10_000,  parseInt(process.env.PER_REQUEST_GAP_MS || '15000', 10));  // >= 10s
const BURST_WINDOW_MS   = Math.max(300_000, parseInt(process.env.BURST_WINDOW_MS || '600000', 10));     // default 10m
const CREDIT_SUSPEND_THRESHOLD = Math.max(0, parseInt(process.env.CREDIT_SUSPEND_THRESHOLD || '2000', 10)); // heuristic only
const SUSPEND_COOLDOWN_MS = Math.max(15 * 60_000, parseInt(process.env.SUSPEND_COOLDOWN_MS || '1800000', 10)); // default 30m
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

if (!API_KEY) console.error('❌ Missing TWITTER_API_KEY');
if (PRIORITY.length + BASE.length === 0) console.error('❌ No accounts configured');

// ---- HTTP client
const http = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': API_KEY },
  timeout: 12000,
});

// ---- State
const lastSeenByHandle = {};  // handle -> last tweet id (string)
const tweetsBuffer = [];      // newest-first for UI
const MAX_TWEETS = 300;

let priorityTimer = null;
let baseTimer = null;
const burstTimers = new Map();   // handle -> interval timer
const burstUntil = {};           // handle -> epoch ms
let suspendedUntil = 0;          // epoch ms when polling may resume
let lastPollAtPriority = null;
let lastPollAtBase = null;
let isMonitoring = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dlog = (...a) => { if (DEBUG) console.log(...a); };

// ---- Helpers
function mapTweets(raw, author) {
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
      tweetsBuffer.unshift({
        id: t.id, author: t.author, text: t.text,
        created_at: t.created_at, url: t.url
      });
    }
  }
  if (tweetsBuffer.length > MAX_TWEETS) tweetsBuffer.length = MAX_TWEETS;
}

function logNewTweets(handle, fresh) {
  if (!fresh || !fresh.length) return;
  const first = fresh[0];
  const preview = first.text.replace(/\s+/g, ' ').slice(0, 120) + (first.text.length > 120 ? '…' : '');
  const ts = new Date(first.created_at).toISOString();
  console.log(`🆕 ${ts} @${handle} — ${fresh.length} tweet(s). First: ${preview}`);
}

// ---- Core fetch
async function fetchLastTweets(handle) {
  const params = { userName: handle, includeReplies: false };
  try {
    const res = await http.get('/twitter/user/last_tweets', { params });
    const tweets = mapTweets(res?.data?.tweets || [], handle);
    const since = lastSeenByHandle[handle];
    const fresh = since ? tweets.filter(t => t.id > since) : tweets;
    if (fresh.length) lastSeenByHandle[handle] = fresh[0].id;
    return fresh;
  } catch (e) {
    const st = e?.response?.status;
    // 402: payment required — suspend globally
    if (st === 402) {
      suspendedUntil = Date.now() + SUSPEND_COOLDOWN_MS;
      console.warn(`⚠️ 402 for @${handle}. Suspending all polling until ${new Date(suspendedUntil).toISOString()}`);
      return [];
    }
    // 429: rate limit — back off at account level
    if (st === 429) {
      dlog(`429 @${handle} — backing off ${BASE_INTERVAL}ms`);
      await sleep(BASE_INTERVAL);
      return [];
    }
    if (st && st !== 404) {
      console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    }
    return [];
  }
}

// ---- Burst control
function ensureBurst(handle) {
  const now = Date.now();
  burstUntil[handle] = Math.max(burstUntil[handle] || 0, now + BURST_WINDOW_MS);
  if (burstTimers.has(handle)) return; // already running

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
      logNewTweets(handle, fresh);
      // extend burst if replies/threads keep coming
      burstUntil[handle] = Date.now() + BURST_WINDOW_MS;
    }
  }, Math.max(60_000, PRIORITY_INTERVAL)); // burst cadence ~60s

  burstTimers.set(handle, t);
  console.log(`⚡ Burst started for @${handle} (until ${new Date(burstUntil[handle]).toISOString()})`);
}

// ---- Loops
async function priorityLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtPriority = new Date().toISOString();

  for (let i = 0; i < PRIORITY.length; i++) {
    const handle = PRIORITY[i];
    if (i) await sleep(GAP_MS);
    const fresh = await fetchLastTweets(handle);
    if (fresh.length) {
      pushTweets(fresh);
      logNewTweets(handle, fresh);
      ensureBurst(handle); // keep bursts for priority too (threads)
    }
  }
}

async function baseLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtBase = new Date().toISOString();

  for (let i = 0; i < BASE.length; i++) {
    const handle = BASE[i];
    if (i) await sleep(GAP_MS);
    const fresh = await fetchLastTweets(handle);
    if (fresh.length) {
      pushTweets(fresh);
      logNewTweets(handle, fresh);
      ensureBurst(handle); // promote to burst cadence for a while
    }
  }
}

// ---- Public API
async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if (!API_KEY || (PRIORITY.length + BASE.length) === 0) {
    return { ok: false, message: 'missing config' };
  }

  console.log(`🚀 Monitoring started. Priority=${PRIORITY.join(',') || '(none)'} (${PRIORITY_INTERVAL}ms)  Base=${BASE.join(',') || '(none)'} (${BASE_INTERVAL}ms)  Gap=${GAP_MS}ms  Burst=${BURST_WINDOW_MS}ms`);
  isMonitoring = true;

  // initial pass
  await priorityLoopOnce();
  await baseLoopOnce();

  // schedule loops
  priorityTimer = setInterval(() => priorityLoopOnce().catch(e => console.error('Priority loop error:', e?.message || e)), PRIORITY_INTERVAL);
  baseTimer     = setInterval(() => baseLoopOnce().catch(e => console.error('Base loop error:', e?.message || e)), BASE_INTERVAL);

  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (priorityTimer) clearInterval(priorityTimer);
  if (baseTimer) clearInterval(baseTimer);
  for (const t of burstTimers.values()) clearInterval(t);
  burstTimers.clear();
  isMonitoring = false;
  return { ok: true, message: 'stopped' };
}

function getRecentTweets(limit = 20) {
  const n = Math.max(1, Math.min(parseInt(limit || 20, 10), MAX_TWEETS));
  return tweetsBuffer.slice(0, n);
}

function getStatus() {
  return {
    ok: true,
    monitoring: isMonitoring,
    priorityAccounts: PRIORITY,
    baseAccounts: BASE,
    totalTweets: tweetsBuffer.length,
    lastPollAtPriority,
    lastPollAtBase,
    priorityIntervalMs: PRIORITY_INTERVAL,
    baseIntervalMs: BASE_INTERVAL,
    gapMs: GAP_MS,
    burstWindowMs: BURST_WINDOW_MS,
    suspended: Date.now() < suspendedUntil,
    suspendedUntil: Date.now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  getRecentTweets,
  getStatus,
};
