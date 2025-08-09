const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'x-api-key': process.env.TWITTER_API_KEY },
  timeout: 12000
});

async function resolveHandleToId(handle) {
  const h = String(handle).replace(/^@/, '').toLowerCase();
  try {
    const r = await client.get('/tweets/search', { params: { q: `from:${h}`, limit: 1 } });
    const t = (r?.data?.data || [])[0];
    const id = t?.author_id || t?.user_id;
    return id ? String(id) : null;
  } catch (_) {
    return null;
  }
}

module.exports = { resolveHandleToId };   // <-- IMPORTANT
