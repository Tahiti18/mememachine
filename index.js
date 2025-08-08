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
  mode: process.env.SYSTEM_MODE || 'demo',
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
    environment: process.env.NODE_ENV || 'development',
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
  const validModes = ['demo', 'simulation', 'paper_trading', 'live'];

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

// Tweet analysis endpoint
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

// Start monitoring endpoint
app.post('/api/monitor/start', async (req, res) => {
  try {
    const { accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor'] } = req.body;

    if (systemStatus.mode === 'demo') {
      return res.json({
        message: 'Demo mode - monitoring simulation started',
        accounts,
        mode: 'demo'
      });
    }

    // Start real monitoring
    await twitterMonitor.start(accounts);
    systemStatus.monitoring = true;

    console.log('Monitoring started for accounts:', accounts);

    res.json({
      message: 'Monitoring started',
      accounts,
      mode: systemStatus.mode
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

// Get recent tweets endpoint
app.get('/api/tweets/recent', async (req, res) => {
  try {
    if (systemStatus.mode === 'demo') {
      // Return demo data
      const demoTweets = [
        {
          id: '1',
          author: 'elonmusk',
          content: 'The future of currency is digital and decentralized',
          timestamp: new Date(Date.now() - 2 * 60000).toISOString(),
          analysis: {
            sentiment: 94,
            viral: 89,
            impact: 97,
            confidence: 96,
            signal: 'HIGH'
          }
        },
        {
          id: '2',
          author: 'VitalikButerin',
          content: 'Ethereum\'s next upgrade will revolutionize scalability',
          timestamp: new Date(Date.now() - 8 * 60000).toISOString(),
          analysis: {
            sentiment: 78,
            viral: 56,
            impact: 71,
            confidence: 82,
            signal: 'MEDIUM'
          }
        },
        {
          id: '3',
          author: 'michael_saylor',
          content: 'Bitcoin is digital energy stored in cyberspace',
          timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
          analysis: {
            sentiment: 85,
            viral: 43,
            impact: 62,
            confidence: 78,
            signal: 'PROCESSING'
          }
        }
      ];

      return res.json({ tweets: demoTweets });
    }

    // Get real tweets
    const tweets = await twitterMonitor.getRecentTweets();
    res.json({ tweets });

  } catch (error) {
    console.error('Recent tweets error:', error);
    res.status(500).json({ error: 'Failed to get recent tweets' });
  }
});

// Token creation endpoint (simulation/live)
app.post('/api/token/create', async (req, res) => {
  try {
    const { tweetAnalysis, tokenData } = req.body;

    if (systemStatus.mode === 'demo') {
      return res.json({
        message: 'Demo mode - token creation simulated',
        token: {
          name: 'ELONMARS',
          symbol: 'EMARS',
          created: true,
          cost: 0
        }
      });
    }

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
      message: 'Live token creation not implemented yet',
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
    timestamp: new Date().toISOString()
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
  console.log(`🎯 System Mode: ${process.env.SYSTEM_MODE || 'demo'}`);
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
