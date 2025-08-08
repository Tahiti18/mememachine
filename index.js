const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Import services
const AIEnsemble = require('./services/aiEnsemble');
const ModelRouter = require('./services/modelRouter');
const SentimentAnalyzer = require('./services/sentimentAnalyzer');
const TwitterMonitor = require('./services/twitterMonitor');

// Initialize services
const aiEnsemble = new AIEnsemble({
  apiKey: process.env.OPENROUTER_API_KEY,
  mode: process.env.AI_ENSEMBLE_MODE || 'adaptive'
});

const modelRouter = new ModelRouter();
const sentimentAnalyzer = new SentimentAnalyzer(aiEnsemble);
const twitterMonitor = new TwitterMonitor({
  apiKey: process.env.TWITTER_API_KEY,
  sentimentAnalyzer
});

// Global state
let systemStatus = {
  status: 'online',
  mode: 'production', // Changed from demo to production
  apiHealth: {
    openrouter: false,
    twitter: false,
    database: false
  },
  stats: {
    totalInvested: 0,
    tweetsAnalyzed: 0,
    tokensCreated: 0,
    successRate: 0
  },
  monitoring: false
};

// Routes

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'SUCCESS',
    message: '🚀 Meme Coin Automation Platform is RUNNING!',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'production',
    uptime: Math.floor(process.uptime()) + ' seconds',
    aiEnsemble: {
      mode: process.env.AI_ENSEMBLE_MODE || 'adaptive',
      modelsAvailable: aiEnsemble.getAvailableModels().length
    }
  });
});

// System status endpoint
app.get('/api/status', async (req, res) => {
  try {
    // Check API health
    systemStatus.apiHealth.openrouter = await checkOpenRouterHealth();
    systemStatus.apiHealth.twitter = await checkTwitterHealth();
    systemStatus.apiHealth.database = true; // Mock for now

    res.json(systemStatus);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Set system mode
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  const validModes = ['simulation', 'paper_trading', 'live']; // Removed demo

  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  systemStatus.mode = mode;
  console.log(`System mode changed to: ${mode}`);

  res.json({ 
    message: `Mode changed to ${mode}`,
    mode: systemStatus.mode 
  });
});

// Tweet analysis endpoint - ALWAYS ACTIVE
app.post('/api/analyze', async (req, res) => {
  try {
    const { tweet, author, metadata } = req.body;

    if (!tweet) {
      return res.status(400).json({ error: 'Tweet content required' });
    }

    console.log(`Analyzing tweet from @${author}: "${tweet.substring(0, 50)}..."`);

    // Use AI ensemble for analysis
    const analysis = await sentimentAnalyzer.analyzeTweet({
      content: tweet,
      author,
      metadata
    });

    // Update stats
    systemStatus.stats.tweetsAnalyzed++;

    res.json({
      success: true,
      analysis,
      mode: systemStatus.mode,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed',
      details: error.message 
    });
  }
});

// Twitter monitoring endpoints - ALWAYS ACTIVE
app.get('/api/twitter/monitor', async (req, res) => {
  try {
    const monitoringStatus = await twitterMonitor.getStatus();
    res.json({
      status: 'active',
      monitoring: systemStatus.monitoring,
      accounts: ['elonmusk', 'VitalikButerin', 'michael_saylor'],
      ...monitoringStatus
    });
  } catch (error) {
    console.error('Twitter monitor error:', error);
    res.status(500).json({ error: 'Failed to get monitoring status' });
  }
});

app.get('/api/twitter/analyze', async (req, res) => {
  try {
    const recentTweets = await twitterMonitor.getRecentTweets();
    res.json({
      success: true,
      tweets: recentTweets,
      analyzedCount: systemStatus.stats.tweetsAnalyzed
    });
  } catch (error) {
    console.error('Twitter analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze tweets' });
  }
});

app.get('/api/twitter/latest', async (req, res) => {
  try {
    const latestTweets = await twitterMonitor.getLatestTweets();
    res.json({ tweets: latestTweets });
  } catch (error) {
    console.error('Latest tweets error:', error);
    res.status(500).json({ error: 'Failed to get latest tweets' });
  }
});

app.get('/api/twitter/sentiment', async (req, res) => {
  try {
    const sentimentData = await sentimentAnalyzer.getRecentAnalysis();
    res.json({ sentiment: sentimentData });
  } catch (error) {
    console.error('Sentiment error:', error);
    res.status(500).json({ error: 'Failed to get sentiment data' });
  }
});

// AI Analysis endpoints - ALWAYS ACTIVE
app.get('/api/ai/analyze', async (req, res) => {
  try {
    const aiStatus = aiEnsemble.getStatus();
    res.json({
      status: 'active',
      ensemble: aiStatus,
      analysisCapable: true
    });
  } catch (error) {
    console.error('AI analyze error:', error);
    res.status(500).json({ error: 'Failed to get AI analysis status' });
  }
});

app.get('/api/ai/sentiment', async (req, res) => {
  try {
    const sentimentStats = await sentimentAnalyzer.getStats();
    res.json({ sentiment: sentimentStats });
  } catch (error) {
    console.error('AI sentiment error:', error);
    res.status(500).json({ error: 'Failed to get AI sentiment' });
  }
});

app.get('/api/ai/ensemble', async (req, res) => {
  try {
    const ensembleStatus = aiEnsemble.getStatus();
    res.json({ ensemble: ensembleStatus });
  } catch (error) {
    console.error('AI ensemble error:', error);
    res.status(500).json({ error: 'Failed to get ensemble status' });
  }
});

app.get('/api/sentiment/analyze', async (req, res) => {
  try {
    const analysis = await sentimentAnalyzer.getRecentAnalysis();
    res.json({ analysis });
  } catch (error) {
    console.error('Sentiment analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze sentiment' });
  }
});

// Token endpoints - ALWAYS ACTIVE
app.get('/api/tokens/create', (req, res) => {
  res.json({
    message: 'Token creation endpoint active',
    mode: systemStatus.mode,
    tokensCreated: systemStatus.stats.tokensCreated
  });
});

app.get('/api/tokens/list', (req, res) => {
  res.json({
    tokens: [],
    totalCreated: systemStatus.stats.tokensCreated,
    message: 'Token list endpoint active'
  });
});

app.get('/api/tokens/status', (req, res) => {
  res.json({
    status: 'active',
    tokensCreated: systemStatus.stats.tokensCreated,
    successRate: systemStatus.stats.successRate
  });
});

// Trading endpoints - ALWAYS ACTIVE
app.get('/api/trading/status', (req, res) => {
  res.json({
    status: 'active',
    mode: systemStatus.mode,
    totalInvested: systemStatus.stats.totalInvested,
    successRate: systemStatus.stats.successRate
  });
});

app.get('/api/trading/history', (req, res) => {
  res.json({
    history: [],
    totalTrades: 0,
    message: 'Trading history endpoint active'
  });
});

app.get('/api/performance', (req, res) => {
  res.json({
    performance: {
      totalInvested: systemStatus.stats.totalInvested,
      successRate: systemStatus.stats.successRate,
      tweetsAnalyzed: systemStatus.stats.tweetsAnalyzed,
      tokensCreated: systemStatus.stats.tokensCreated
    },
    status: 'active'
  });
});

// Cost management - ALWAYS ACTIVE
app.get('/api/costs', (req, res) => {
  res.json({
    totalCosts: 0,
    breakdown: {
      twitterAPI: 0,
      openRouterAPI: 0,
      tokenCreation: 0
    },
    status: 'active'
  });
});

app.get('/api/costs/breakdown', (req, res) => {
  res.json({
    breakdown: {
      daily: 0,
      weekly: 0,
      monthly: 0
    },
    status: 'active'
  });
});

// Configuration - ALWAYS ACTIVE
app.get('/api/config', (req, res) => {
  res.json({
    mode: systemStatus.mode,
    apiHealth: systemStatus.apiHealth,
    monitoring: systemStatus.monitoring,
    status: 'active'
  });
});

app.get('/api/settings', (req, res) => {
  res.json({
    settings: {
      mode: systemStatus.mode,
      monitoring: systemStatus.monitoring,
      autoTrading: false
    },
    status: 'active'
  });
});

// Start monitoring endpoint - NO DEMO RESTRICTIONS
app.post('/api/monitor/start', async (req, res) => {
  try {
    const { accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor'] } = req.body;

    // Start monitoring regardless of mode
    await twitterMonitor.start(accounts);
    systemStatus.monitoring = true;

    console.log('Monitoring started for accounts:', accounts);

    res.json({
      message: 'Monitoring started',
      accounts,
      mode: systemStatus.mode,
      status: 'active'
    });

  } catch (error) {
    console.error('Monitoring start error:', error);
    res.status(500).json({ error: 'Failed to start monitoring' });
  }
});

// Stop monitoring endpoint
app.post('/api/monitor/stop', async (req, res) => {
  try {
    await twitterMonitor.stop();
    systemStatus.monitoring = false;

    console.log('Monitoring stopped');

    res.json({
      message: 'Monitoring stopped',
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('Monitoring stop error:', error);
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

// Get recent tweets endpoint - NO DEMO MODE
app.get('/api/tweets/recent', async (req, res) => {
  try {
    // Always try to get real tweets
    const tweets = await twitterMonitor.getRecentTweets();
    res.json({ tweets });

  } catch (error) {
    console.error('Recent tweets error:', error);
    res.status(500).json({ error: 'Failed to get recent tweets' });
  }
});

// Token creation endpoint - NO DEMO RESTRICTIONS
app.post('/api/token/create', async (req, res) => {
  try {
    const { tweetAnalysis, tokenData } = req.body;

    if (systemStatus.mode === 'paper_trading' || systemStatus.mode === 'simulation') {
      // Simulate token creation
      systemStatus.stats.tokensCreated++;

      return res.json({
        message: `${systemStatus.mode} - token creation simulated`,
        token: {
          name: tokenData.name || 'SIMULATOKEN',
          symbol: tokenData.symbol || 'SIM',
          created: true,
          cost: 0,
          simulation: true
        }
      });
    }

    // Live mode - actual token creation would go here
    // This would integrate with Solana/pump.fun
    res.json({
      message: 'Live token creation ready for implementation',
      mode: 'live',
      requiresImplementation: true
    });

  } catch (error) {
    console.error('Token creation error:', error);
    res.status(500).json({ error: 'Token creation failed' });
  }
});

// AI ensemble status endpoint
app.get('/api/ai/status', (req, res) => {
  const ensembleStatus = aiEnsemble.getStatus();
  res.json({
    ensemble: ensembleStatus,
    router: modelRouter.getStats(),
    timestamp: new Date().toISOString(),
    status: 'active'
  });
});

// Helper functions
async function checkOpenRouterHealth() {
  try {
    if (!process.env.OPENROUTER_API_KEY) return false;

    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    return response.status === 200;
  } catch (error) {
    console.error('OpenRouter health check failed:', error.message);
    return false;
  }
}

async function checkTwitterHealth() {
  try {
    if (!process.env.TWITTER_API_KEY) return false;

    const response = await axios.get('https://api.twitterapi.io/v2/users/by/username/elonmusk', {
      headers: {
        'Authorization': `Bearer ${process.env.TWITTER_API_KEY}`
      },
      timeout: 5000
    });

    return response.status === 200;
  } catch (error) {
    console.error('Twitter health check failed:', error.message);
    return false;
  }
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Meme Coin Automation Platform running on port ${PORT}`);
  console.log(`📊 AI Ensemble Mode: ${process.env.AI_ENSEMBLE_MODE || 'adaptive'}`);
  console.log(`🎯 System Mode: PRODUCTION (Demo mode removed)`);
  console.log(`🔗 OpenRouter API: ${process.env.OPENROUTER_API_KEY ? 'Connected' : 'Not configured'}`);
  console.log(`🐦 Twitter API: ${process.env.TWITTER_API_KEY ? 'Connected' : 'Not configured'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
