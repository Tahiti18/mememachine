// services/twitterMonitor.js
// TwitterAPI.io ONLY. Quiet logs. Keeps a ring buffer for the UI.

const axios = require('axios');

const API_KEY = process.env.TWITTER_API_KEY || '';
const HANDLES = (process.env.TWITTER_ACCOUNTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// sane defaults to avoid rate limits
const POLL_MS = Math.max(60000, parseInt(process.env.TWEET_CHECK_INTERVAL || '120000', 10)); // 2 min
const GAP_MS  = Math.max(8000,  parseInt(process.env.PER_REQUEST_GAP_MS || '12000', 10));    // 12 s
const RETRY_BACKOFF_MS = Math.max(POLL_MS, parseInt(process.env.RETRY_BACKOFF_MS || `${POLL_MS}`, 10));
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

if (!API_KEY) console.error('❌ Missing TWITTER_API_KEY');
if (!HANDLES.length) console.error('❌ TWITTER_ACCOUNTS is empty');

const http = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': API_KEY },
  timeout: 12000,
});

const lastSeenByHandle = {}; // handle -> last tweet id (string)
const tweetsBuffer = [];     // newest-first ring buffer for UI
const MAX_TWEETS = 200;

let isMonitoring = false;
let loopTimer = null;
let lastPollAt = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const dlog = (...a) => { if (DEBUG) console.log(...a); };

function mapTweets(raw, author) {
  return (raw || []).map(t => ({
    id: String(t.id || t.id_str),
    text: t.text || '',
    created_at: t.createdAt || t.created_at || new Date().toISOString(),
    author,
    url: t.url || `https://x.com/${author}/status/${t.id}`,
  }));
}

function pushTweets(list) {
  if (!Array.isArray(list) || !list.length) return;
  // newest first
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const t of list) {
    if (!tweetsBuffer.find(x => x.id === String(t.id))) {
      tweetsBuffer.unshift({
        id: String(t.id),
        author: t.author,
        text: t.text || '',
        created_at: t.created_at || new Date().toISOString(),
        url: t.url,
      });
    }
  }
  if (tweetsBuffer.length > MAX_TWEETS) tweetsBuffer.length = MAX_TWEETS;
}

async function fetchLastTweets(handle) {
  const params = { userName: handle, includeReplies: false };

  try {
    const res = await http.get('/twitter/user/last_tweets', { params });
    const tweets = mapTweets(res?.data?.tweets || [], handle);

    const since = lastSeenByHandle[handle];
    const fresh = since ? tweets.filter(t => String(t.id) > String(since)) : tweets;

    if (fresh.length) lastSeenByHandle[handle] = String(fresh[0].id);
    return fresh;
  } catch (e) {
    const st = e?.response?.status;
    if (st === 429) {
      dlog(`429 @${handle} — backoff ${RETRY_BACKOFF_MS}ms`);
      await sleep(RETRY_BACKOFF_MS);
      try {
        const retry = await http.get('/twitter/user/last_tweets', { params });
        const rTweets = mapTweets(retry?.data?.tweets || [], handle);
        const since2 = lastSeenByHandle[handle];
        const fresh2 = since2 ? rTweets.filter(t => String(t.id) > String(since2)) : rTweets;
        if (fresh2.length) lastSeenByHandle[handle] = String(fresh2[0].id);
        return fresh2;
      } catch { return []; }
    }
    if (st && st !== 404) console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    return [];
  }
}

async function pollOnce() {
  lastPollAt = new Date().toISOString();
  for (let i = 0; i < HANDLES.length; i++) {
    const handle = HANDLES[i];
    if (i) await sleep(GAP_MS);
    const fresh = await fetchLastTweets(handle);
    pushTweets(fresh);
    if (fresh.length) {
      const first = fresh[0];
      const preview = first.text.replace(/\s+/g, ' ').slice(0, 120) + (first.text.length > 120 ? '…' : '');
      console.log(`🆕 ${first.created_at} @${handle} — ${fresh.length} tweet(s). First: ${preview}`);
    }
  }
}

async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if (!API_KEY || !HANDLES.length) return { ok: false, message: 'missing config' };

  console.log(`🚀 Starting TwitterAPI.io monitoring for ${HANDLES.length} account(s)…  Poll=${POLL_MS}ms  Gap=${GAP_MS}ms`);
  isMonitoring = true;

  await pollOnce();
  loopTimer = setInterval(async () => {
    try { await pollOnce(); } catch (e) { console.error('❌ Poll failed:', e?.message || e); }
  }, POLL_MS);

  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
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
    accounts: HANDLES,
    totalTweets: tweetsBuffer.length,
    lastPollAt,
    pollMs: POLL_MS,
    gapMs: GAP_MS,
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  getRecentTweets,
  getStatus,
};
