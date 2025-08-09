const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'x-api-key': process.env.TWITTER_API_KEY },
  timeout: 12000
});

// Returns: string userId OR null
async function resolveHandleToId(handleRaw) {
  const h = String(handleRaw).replace(/^@/, '').toLowerCase();

  // 1) Try provider's "user tweets" (works on many plans)
  //    /tweets/user/:username?limit=1 -> take t.user_id || t.author_id
  try {
    const r1 = await client.get(`/tweets/user/${encodeURIComponent(h)}`, { params: { limit: 1 } });
    const t1 = (r1?.data?.data || [])[0];
    const id1 = t1?.user_id || t1?.author_id;
    if (id1) return String(id1);
  } catch (_) {}

  // 2) Try a "users by username" style endpoint (name varies by provider)
  //    /users/by-username/:username  OR /user/:username
  const userPaths = [
    `/users/by-username/${encodeURIComponent(h)}`,
    `/user/${encodeURIComponent(h)}`
  ];
  for (const p of userPaths) {
    try {
      const r2 = await client.get(p);
      const id2 =
        r2?.data?.data?.id ||
        r2?.data?.id ||
        r2?.data?.user?.id ||
        r2?.data?.user_id;
      if (id2) return String(id2);
    } catch (_) {}
  }

  // 3) Fallback: search a tweet "from:<handle>" then read author_id
  try {
    const r3 = await client.get('/tweets/search', { params: { q: `from:${h}`, limit: 1 } });
    const t3 = (r3?.data?.data || [])[0];
    const id3 = t3?.author_id || t3?.user_id;
    if (id3) return String(id3);
  } catch (_) {}

  return null;
}

module.exports = { resolveHandleToId };
