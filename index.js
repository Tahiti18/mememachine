const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1); // Fix for Railway/Netlify proxies

app.use(express.json());

const PORT = process.env.PORT || 8080;
let monitoring = false;
let monitorInterval = null;

// Rate limiter for all endpoints
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, error: 'Too many requests, please slow down.' }
});
app.use(limiter);

// Twitter API credentials
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const PRIORITY_ACCOUNTS = ['elonmusk', 'vitalikbuterin'];
const BASE_ACCOUNTS = ['michael_saylor', 'justinsuntron', 'cz_binance'];

async function fetchTweets() {
  try {
    console.log('Fetching tweets...');
    // Replace with actual Twitter API call
    const res = await axios.get(`https://api.twitterapi.io/v2/tweets`, {
      headers: { Authorization: `Bearer ${TWITTER_API_KEY}` }
    });
    console.log(res.data);
  } catch (err) {
    console.error('Error fetching tweets:', err.message);
  }
}

// --- API Endpoints --- //

app.get('/', (req, res) => {
  res.send('MemeMachine API online');
});

app.get('/api/status', (req, res) => {
  res.json({
    base: BASE_ACCOUNTS,
    priority: PRIORITY_ACCOUNTS,
    monitoring
  });
});

app.post('/api/monitor/start', (req, res) => {
  if (monitoring) {
    return res.json({ ok: true, message: 'already running' });
  }
  monitoring = true;
  monitorInterval = setInterval(fetchTweets, 60_000);
  res.json({ ok: true, message: 'monitoring started' });
});

app.post('/api/monitor/stop', (req, res) => {
  if (!monitoring) {
    return res.json({ ok: true, message: 'not running' });
  }
  clearInterval(monitorInterval);
  monitoring = false;
  res.json({ ok: true, message: 'stopped' });
});

app.get('/api/tweets/recent', (req, res) => {
  // Placeholder until connected to DB
  res.json({ tweets: [] });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
