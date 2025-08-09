// services/twitterMonitor.js
// TwitterAPI.io monitor (no official X API)
// Env vars needed:
// - TWITTER_API_KEY      -> your TwitterAPI.io key
// - TWITTER_ACCOUNTS     -> comma list of handles (no @)
// - TWEET_CHECK_INTERVAL -> ms between polling cycles (min 30000)
// - PER_REQUEST_GAP_MS   -> ms gap between accounts (min 6000)

const axios = require('axios');

const API_KEY = process.env.TWITTER_API_KEY || '';
const HANDLES = (process.env.TWITTER_ACCOUNTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const POLL_MS = Math.max(30000, parseInt(process.env.TWEET_CHECK_INTERVAL || '60000', 10));
const GAP_MS  = Math.max(6000,  parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10));
const RETRY_BACKOFF_MS = Math.max(POLL_MS, parseInt(process.env.RETRY_BACKOFF_MS || `${POLL_MS}`, 10));

if (!API_KEY) {
  console.error('❌ Missing TWITTER_API_KEY (TwitterAPI.io).');
}
if (HANDLES.length === 0) {
  console.error('❌ TWITTER_ACCOUNTS is empty.');
}

// track last seen per handle to fetch only new tweets
const lastSeenByHandle = {}; // handle -> tweet id

const client = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'x-api-key': API_KEY },
  timeout: 12000,
});

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function mapTweets(raw, author) {
  return raw.map(t => ({
    id: t.id_str || t.id,
    text: t.full_text || t.text || '',
    created_at: t.created_at || t.date,
    author,
    public_metrics: t.metrics || t.public_metrics || {},
    url: `https://x.com/${author}/status/${t.id_str || t.id}`,
  }));
}

async function fetchTweetsForHandle(handle) {
  const since_id = lastSeenByHandle[handle];
  const params = { limit: 10, ...(since_id ? { since_id } : {}) };

  // try once; if 429, back off once and retry
  const doReq = async () => client.get(`/tweets/user/${encodeURIComponent(handle)}`, { params });

  try {
    const res = await doReq();
    const raw = res?.data?.data || [];
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const mapped = mapTweets(raw, handle);
    // newest first assumed; update since_id
    if (mapped.length > 0) lastSeenByHandle[handle] = mapped[0].id;
    return mapped;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) {
      console.warn(`⏳ 429 for @${handle} — backoff ${RETRY_BACKOFF_MS}ms then retry once`);
      await sleep(RETRY_BACKOFF_MS);
      const res2 = await doReq(); // let throw if still bad
      const raw2 = res2?.data?.data || [];
      const mapped2 = mapTweets(raw2, handle);
      if (mapped2.length > 0) lastSeenByHandle[handle] = mapped2[0].id;
      return mapped2;
    }
    if (status === 404) {
      console.warn(`⚠️ 404 from TwitterAPI.io for @${handle} (no data)`);
      return [];
    }
    const data = err?.response?.data;
    console.error(`❌ TwitterAPI.io error for @${handle}${status ? ` [${status}]` : ''}: ${data ? JSON.stringify(data).slice(0,300) : (err.message || 'Unknown error')}`);
    return [];
  }
}

async function pollOnce() {
  for (let i = 0; i < HANDLES.length; i++) {
    const handle = HANDLES[i];
    if (i > 0) await sleep(GAP_MS);
    const tweets = await fetchTweetsForHandle(handle);
    for (const t of tweets) {
      // This is where you’d push to your pipeline / sentiment analyzer.
      console.log(`🆕 @${handle}: ${t.text.slice(0, 120).replace(/\s+/g, ' ')}${t.text.length > 120 ? '…' : ''}`);
    }
  }
}

async function startMonitoring() {
  console.log(`🚀 Starting TwitterAPI.io monitoring for ${HANDLES.length} accounts...`);
  if (!API_KEY || HANDLES.length === 0) {
    console.error('⛔ Cannot start: missing API key or accounts.');
    return;
  }

  // initial pass
  await pollOnce();

  // loop
  setInterval(async () => {
    try {
      await pollOnce();
    } catch (e) {
      console.error('❌ Poll cycle failed:', e?.message || e);
    }
  }, POLL_MS);
}

module.exports = { startMonitoring };
