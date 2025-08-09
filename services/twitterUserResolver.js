const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'x-api-key': process.env.TWITTER_API_KEY },
  timeout: 12000
});

// Returns: string userId OR null
async function resolveHandleToId(handle) {
  const h = String(handle).replace(/^@/, '').toLowerCase();

  try {
    // Free-tier compatible: find one tweet by that handle and read author id
    const r = await client.get('/tweets/search', { params: { q: `from:${h}`, limit: 1 } });
    const t = (r?.data?.data || [])[0];
    const id = t?.author_id || t?.user_id;
    return id ? String(id) : null;
  } catch (_) {
    return null;
  }
}

module.exports = { resolveHandleToId };
