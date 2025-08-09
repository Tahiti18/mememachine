const axios = require('axios');

async function getUserIdByUsername(username) {
    const apiKey = process.env.TWITTER_API_KEY;
    const url = `https://api.twitter.com/2/users/by/username/${username}?user.fields=id`;

    const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!res.data.data || !res.data.data.id) {
        throw new Error('User ID not found');
    }

    return res.data.data.id;
}

module.exports = { getUserIdByUsername };
