// services/twitterMonitor.js

const axios = require("axios");

const API_KEY = process.env.TWITTER_API_KEY;
const ACCOUNTS = process.env.TWITTER_ACCOUNTS
  ? process.env.TWITTER_ACCOUNTS.split(",").map(a => a.trim())
  : [];

if (!API_KEY) {
  console.error("❌ No TWITTER_API_KEY found in environment variables.");
  process.exit(1);
}

if (ACCOUNTS.length === 0) {
  console.error("❌ No TWITTER_ACCOUNTS found in environment variables.");
  process.exit(1);
}

// Function to fetch Twitter user ID from TwitterAPI.io
async function getUserId(username) {
  try {
    const response = await axios.get(`https://twitterapi.io/api/user/${username}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });

    if (response.data && response.data.data && response.data.data.id) {
      return response.data.data.id;
    } else {
      console.error(`⚠️ Could not get ID for ${username}`);
      return null;
    }
  } catch (err) {
    console.error(`❌ Error fetching ID for ${username}:`, err.response?.data || err.message);
    return null;
  }
}

// Main monitoring start
(async () => {
  console.log(`🚀 Starting Twitter monitoring for ${ACCOUNTS.length} accounts...`);

  const accountIds = {};
  for (const username of ACCOUNTS) {
    const id = await getUserId(username);
    if (id) {
      accountIds[username] = id;
      console.log(`✅ ${username} -> ${id}`);
    }
  }

  if (Object.keys(accountIds).length === 0) {
    console.error("❌ No valid accounts found. Exiting.");
    process.exit(1);
  }

  // Here you’d start your tweet fetching loop
  setInterval(async () => {
    for (const [username, id] of Object.entries(accountIds)) {
      try {
        const tweets = await axios.get(`https://twitterapi.io/api/tweets/${id}`, {
          headers: { Authorization: `Bearer ${API_KEY}` }
        });
        console.log(`📢 ${username}: ${tweets.data.data.length} tweets fetched`);
      } catch (err) {
        console.error(`❌ Error fetching tweets for ${username}:`, err.response?.data || err.message);
      }
    }
  }, 60000); // every 60 sec
})();
