// services/twitterMonitor.js

const { TwitterApi } = require('twitter-api-v2');
require('dotenv').config();

const accounts = process.env.TWITTER_ACCOUNTS
  ? process.env.TWITTER_ACCOUNTS.split(',').map(acc => acc.trim())
  : [];

const twitterClient = new TwitterApi(process.env.TWITTER_API_KEY);

async function fetchTweets(username) {
  try {
    const user = await twitterClient.v2.userByUsername(username);
    if (!user || !user.data || !user.data.id) {
      console.error(`❌ Could not find user ID for ${username}`);
      return [];
    }

    const tweets = await twitterClient.v2.userTimeline(user.data.id, {
      max_results: 5,
      'tweet.fields': 'created_at,text'
    });

    if (!tweets.data || !tweets.data.data) {
      console.log(`ℹ No tweets found for ${username}`);
      return [];
    }

    console.log(`✅ Latest tweets fetched for ${username}`);
    return tweets.data.data;
  } catch (err) {
    console.error(`❌ Error fetching tweets for ${username}:`, err.message);
    return [];
  }
}

async function startMonitoring() {
  console.log(`🚀 Starting Twitter monitoring for ${accounts.length} accounts...`);
  for (const account of accounts) {
    await fetchTweets(account);
  }

  // Repeat at interval if needed
  const intervalMs = parseInt(process.env.TWEET_CHECK_INTERVAL || '60000', 10);
  setInterval(async () => {
    for (const account of accounts) {
      await fetchTweets(account);
    }
  }, intervalMs);
}

module.exports = {
  startMonitoring
};
