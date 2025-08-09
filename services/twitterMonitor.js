// services/twitterMonitor.js
const axios = require('axios');

const API_KEY = process.env.TWITTER_API_KEY || '';
const HANDLES = (process.env.TWITTER_ACCOUNTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const POLL_MS = Math.max(30000, parseInt(process.env.TWEET_CHECK_INTERVAL || '60000', 10));
const GAP_MS  = Math.max(6000,  parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10));
const NITTER_BASE = (process.env.NITTER_BASE || 'https://nitter.net').replace(/\/$/, '');

if (!API_KEY) console.error('❌ Missing TWITTER_API_KEY.');
if (!HANDLES.length) console.error('❌ TWITTER_ACCOUNTS is empty.');

const http = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'x-api-key': API_KEY },
  timeout: 12000,
});

const lastSeenByHandle = {};       // handle -> tweet id
const sourceByHandle = {};         // handle -> 'twitterapi' | 'nitter'

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mapTwitterApiTweets(raw, author) {
  return raw.map(t => ({
    id: t.id_str || t.id,
    text: t.full_text || t.text || '',
    created_at: t.created_at || t.date,
    author,
    url: `https://x.com/${author}/status/${t.id_str || t.id}`,
  }));
}

function mapNitterItems(items, author) {
  return items.map(it => {
    const link = (it.link && it.link[0]) || '';
    const id = String(link).split('/').filter(Boolean).pop() || (it.guid && it.guid[0]) || `${Date.now()}`;
    return {
      id,
      text: (it.title && it.title[0]) || '',
      created_at: (it.pubDate && it.pubDate[0]) || new Date().toISOString(),
      author,
      url: link || `https://x.com/${author}/status/${id}`,
    };
  });
}

async function fetchViaTwitterApi(handle) {
  const since_id = lastSeenByHandle[handle];
  const params = { limit: 10, ...(since_id ? { since_id } : {}) };
  const doReq = () => http.get(`/tweets/user/${encodeURIComponent(handle)}`, { params });

  try {
    const res = await doReq();
    const raw = res?.data?.data || [];
    const mapped = mapTwitterApiTweets(raw, handle);
    if (mapped.length) lastSeenByHandle[handle] = mapped[0].id;
    return mapped;
  } catch (e) {
    const st = e?.response?.status;
    if (st === 429) {
      await sleep(POLL_MS);
      const r2 = await doReq();
      const raw2 = r2?.data?.data || [];
      const mapped2 = mapTwitterApiTweets(raw2, handle);
      if (mapped2.length) lastSeenByHandle[handle] = mapped2[0].id;
      return mapped2;
    }
    if (st === 404) return null; // signal “no data here”
    throw e;
  }
}

async function fetchViaNitter(handle) {
  try {
    const url = `${NITTER_BASE}/${encodeURIComponent(handle)}/rss`;
    const resp = await axios.get(url, { timeout: 12000 });
    const xml = resp?.data;
    // Tiny XML parse without deps (match items)
    const items = Array.from(String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)).map(m => {
      const block = m[1];
      const get = tag => {
        const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
        return r ? [r[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()] : [];
      };
      return { title: get('title'), link: get('link'), guid: get('guid'), pubDate: get('pubDate') };
    });
    const mapped = mapNitterItems(items, handle);
    const since_id = lastSeenByHandle[handle];
    const filtered = since_id ? mapped.filter(t => t.id > since_id) : mapped;
    if (filtered.length) lastSeenByHandle[handle] = filtered[0].id;
    return filtered.slice(0,10);
  } catch (e) {
    console.warn(`Nitter failed for @${handle}: ${e?.message || e}`);
    return [];
  }
}

async function probeHandle(handle) {
  try {
    const test = await http.get(`/tweets/user/${encodeURIComponent(handle)}`, { params: { limit: 1 } });
    const ok = Array.isArray(test?.data?.data);
    sourceByHandle[handle] = ok ? 'twitterapi' : 'nitter';
  } catch (e) {
    sourceByHandle[handle] = e?.response?.status === 404 ? 'nitter' : 'twitterapi';
  }
  console.log(`🔧 @${handle} → ${sourceByHandle[handle]}`);
}

async function pollOnce() {
  for (let i = 0; i < HANDLES.length; i++) {
    const handle = HANDLES[i];
    if (i) await sleep(GAP_MS);
    let tweets = [];
    if (sourceByHandle[handle] === 'twitterapi') {
      const r = await fetchViaTwitterApi(handle);
      if (r === null) { // 404 case → switch to nitter
        sourceByHandle[handle] = 'nitter';
        tweets = await fetchViaNitter(handle);
      } else {
        tweets = r || [];
      }
    } else {
      tweets = await fetchViaNitter(handle);
    }
    for (const t of tweets) {
      console.log(`🆕 @${handle}: ${t.text.replace(/\s+/g,' ').slice(0,120)}${t.text.length>120?'…':''}`);
    }
  }
}

async function startMonitoring() {
  console.log(`🚀 Starting TwitterAPI.io monitoring for ${HANDLES.length} accounts...`);
  if (!API_KEY || !HANDLES.length) return;

  for (let i = 0; i < HANDLES.length; i++) {
    if (i) await sleep(500);
    await probeHandle(HANDLES[i]);
  }

  await pollOnce();
  setInterval(async () => {
    try { await pollOnce(); } catch (e) { console.error('Poll failed:', e?.message || e); }
  }, POLL_MS);
}

module.exports = { startMonitoring };
