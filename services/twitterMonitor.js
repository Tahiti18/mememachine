// services/twitterMonitor.js

const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');
const dotenv = require('dotenv');
dotenv.config();

const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

const MONITOR_ACCOUNTS = [
  { handle: 'elonmusk', id: '44196397' },
  { handle: 'VitalikButerin', id: '295218981' },
  { handle: 'michael_saylor', id: '244647486' },
  { handle: 'justinsuntron', id: '132029397' },
  { handle: 'cz_binance', id: '888659910' },
  { handle: 'naval', id: '745273' },
  { handle: 'APompliano', id: '361289499' },
  { handle: 'balajis', id: '36653169' },
  { handle: 'coinbureau', id: '1190836684856822773' },
  { handle: 'WhalePanda', id: '14198485' }
];

const lastSeenTweets = {};

async function fetchTweets(user) {
  try {
    const tweets = await client.v2.userTimeline(user.id, {
      max_results: 5,
      'tweet.fields': 'created_at'
    });

    if (!tweets.data || !tweets.data.data) return;

    const newTweets = [];
    for (const tweet of tweets.data.data) {
      if (lastSeenTweets[user.id] && tweet.id === lastSeenTweets[user.id]) break;
      newTweets.push(tweet);
    }

    if (newTweets.length > 0) {
      lastSeenTweets[user.id] = newTweets[0].id;
      for (const t of newTweets) {
        console.log(`🆕 New tweet from ${user.handle}: ${t.text}`);
      }
    }
  } catch (err) {
    if (err.code === 404) {
      console.warn(`⚠️ Account not found: ${user.handle}`);
    } else if (err.code === 429) {
      console.error(`⏳ Rate limit hit for ${user.handle}, backing off...`);
    } else {
      console.error(`❌ Error fetching tweets for ${user.handle}:`, err);
    }
  }
}

function startMonitoring() {
  console.log(`🚀 Starting Twitter monitoring for ${MONITOR_ACCOUNTS.length} accounts...`);

  cron.schedule('*/1 * * * *', () => {
    MONITOR_ACCOUNTS.forEach(user => {
      fetchTweets(user);
    });
  });
}

module.exports = { startMonitoring };
