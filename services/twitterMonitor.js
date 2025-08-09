// services/twitterMonitor.js
// TwitterAPI.io ONLY (no X official, no nitter). Quiet logging.

const axios = require('axios');

const API_KEY = process.env.TWITTER_API_KEY || '';
const HANDLES = (process.env.TWITTER_ACCOUNTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const POLL_MS = Math.max(30000, parseInt(process.env.TWEET_CHECK_INTERVAL || '60000', 10));
const GAP_MS  = Math.max(6000,  parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10));
const RETRY_BACKOFF_MS = Math.max(POLL_MS, parseInt(process.env.RETRY_BACKOFF_MS || `${POLL_MS}`, 10));
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

if (!API_KEY) console.error('❌ Missing TWITTER_API_KEY');
if (!HANDLES.length) console.error('❌ TWITTER_ACCOUNTS is empty');

const http = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': API_KEY }, // <- required by TwitterAPI.io
  timeout: 12000,
});

const lastSeenByHandle = {}; // handle -> tweet id
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dlog = (...a) => { if (DEBUG) console.log(...a); };

function mapTweets(raw, author) {
  // docs payload -> normalized minimal shape
  return (raw || []).map(t => ({
    id: t.id || t.id_str,
    text: t.text || '',
    created_at: t.createdAt || t.created_at || new Date().toISOString(),
    author,
    url: t.url || `https://x.com/${author}/status/${t.id}`,
  }));
}

async function fetchLastTweets(handle) {
  const params = {
    userName: handle,
    includeReplies: false,
  };

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
      const retry = await http.get('/twitter/user/last_tweets', { params });
      const rTweets = mapTweets(retry?.data?.tweets || [], handle);
      const since2 = lastSeenByHandle[handle];
      const fresh2 = since2 ? rTweets.filter(t => String(t.id) > String(since2)) : rTweets;
      if (fresh2.length) lastSeenByHandle[handle] = String(fresh2[0].id);
      return fresh2;
    }
    if (st && st !== 404) {
      console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    }
    return [];
  }
}

function logTweets(handle, tweets) {
  if (!tweets || !tweets.length) return;
  const first = tweets[0];
  const preview = first.text.replace(/\s+/g, ' ').slice(0, 120) + (first.text.length > 120 ? '…' : '');
  const ts = new Date(first.created_at).toISOString();
  console.log(`🆕 ${ts} @${handle} — ${tweets.length} tweet(s). First: ${preview}`);
}

async function pollOnce() {
  for (let i = 0; i < HANDLES.length; i++) {
    const handle = HANDLES[i];
    if (i) await sleep(GAP_MS);
    const fresh = await fetchLastTweets(handle);
    logTweets(handle, fresh);
  }
}

async function startMonitoring() {
  console.log(`🚀 Starting TwitterAPI.io monitoring for ${HANDLES.length} account(s)…`);
  console.log(`   Poll=${POLL_MS}ms  Gap=${GAP_MS}ms`);

  // initial pass
  await pollOnce();

  // loop
  setInterval(async () => {
    try { await pollOnce(); } catch (e) { console.error('❌ Poll failed:', e?.message || e); }
  }, POLL_MS);
}

module.exports = { startMonitoring };
