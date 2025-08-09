const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const resolveRoute = require('./monitoring/resolve');
app.use(resolveRoute);
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
  mode: 'production',  // Changed from 'demo' to 'production'
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
  const validModes = ['simulation', 'paper_trading', 'live'];  // Removed 'demo'

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

// Start monitoring endpoint - ALWAYS FUNCTIONAL
app.post('/api/monitor/start', async (req, res) => {
  try {
    const { accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor'] } = req.body;

    // Start real monitoring regardless of mode
    await twitterMonitor.start(accounts);
    systemStatus.monitoring = true;

    console.log('Monitoring started for accounts:', accounts);

    res.json({
      success: true,
      message: 'Monitoring started',
      accounts,
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('Monitoring start error:', error);
    res.status(500).json({ 
      error: 'Failed to start monitoring',
      details: error.message 
    });
  }
});

// Stop monitoring endpoint
app.post('/api/monitor/stop', async (req, res) => {
  try {
    await twitterMonitor.stop();
    systemStatus.monitoring = false;

    console.log('Monitoring stopped');

    res.json({
      success: true,
      message: 'Monitoring stopped',
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('Monitoring stop error:', error);
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

// Get recent tweets endpoint - ALWAYS TRIES REAL DATA
app.get('/api/tweets/recent', async (req, res) => {
  try {
    // Always try to get real tweets
    const tweets = await twitterMonitor.getRecentTweets();
    
    res.json({ 
      success: true,
      tweets,
      mode: systemStatus.mode,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Recent tweets error:', error);
    
    // Return error instead of demo data
    res.status(500).json({ 
      error: 'Failed to get recent tweets',
      details: error.message,
      suggestion: 'Check Twitter API configuration'
    });
  }
});

// Twitter monitoring endpoints
app.get('/api/twitter/monitor', async (req, res) => {
  try {
    const status = await twitterMonitor.getStatus();
    res.json({
      success: true,
      monitoring: systemStatus.monitoring,
      status,
      mode: systemStatus.mode
    });
  } catch (error) {
    console.error('Twitter monitor status error:', error);
    res.status(500).json({ error: 'Failed to get monitor status' });
  }
});

app.post('/api/twitter/analyze', async (req, res) => {
  try {
    const { tweet, author } = req.body;
    
    if (!tweet) {
      return res.status(400).json({ error: 'Tweet content required' });
    }

    const analysis = await sentimentAnalyzer.analyzeTweet({
      content: tweet,
      author: author || 'unknown'
    });

    systemStatus.stats.tweetsAnalyzed++;

    res.json({
      success: true,
      analysis,
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('Tweet analysis error:', error);
    res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
});

// AI Analysis endpoints
app.get('/api/ai/analyze', async (req, res) => {
  try {
    const { text, type = 'sentiment' } = req.query;
    
    if (!text) {
      return res.status(400).json({ error: 'Text parameter required' });
    }

    const analysis = await aiEnsemble.analyze(text, type);
    
    res.json({
      success: true,
      analysis,
      type,
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: 'AI analysis failed', details: error.message });
  }
});

app.get('/api/ai/sentiment', async (req, res) => {
  try {
    const { text } = req.query;
    
    if (!text) {
      return res.status(400).json({ error: 'Text parameter required' });
    }

    const sentiment = await sentimentAnalyzer.analyze(text);
    
    res.json({
      success: true,
      sentiment,
      mode: systemStatus.mode
    });

  } catch (error) {
    console.error('Sentiment analysis error:', error);
    res.status(500).json({ error: 'Sentiment analysis failed', details: error.message });
  }
});

app.get('/api/ai/ensemble', async (req, res) => {
  try {
    const status = aiEnsemble.getStatus();
    res.json({
      success: true,
      ensemble: status,
      mode: systemStatus.mode
    });
  } catch (error) {
    console.error('AI ensemble error:', error);
    res.status(500).json({ error: 'Failed to get ensemble status' });
  }
});

// Token creation endpoint - FUNCTIONAL FOR ALL MODES
app.post('/api/token/create', async (req, res) => {
  try {
    const { tweetAnalysis, tokenData } = req.body;

    if (systemStatus.mode === 'paper_trading' || systemStatus.mode === 'simulation') {
      // Simulate token creation
      systemStatus.stats.tokensCreated++;

      return res.json({
        success: true,
        message: `${systemStatus.mode} - token creation simulated`,
        token: {
          name: tokenData?.name || 'SIMULATOKEN',
          symbol: tokenData?.symbol || 'SIM',
          created: true,
          cost: 0,
          simulation: true,
          mode: systemStatus.mode
        }
      });
    }

    // Live mode - actual token creation would go here
    res.json({
      success: false,
      message: 'Live token creation requires Solana integration',
      mode: 'live',
      requiresImplementation: true
    });

  } catch (error) {
    console.error('Token creation error:', error);
    res.status(500).json({ error: 'Token creation failed', details: error.message });
  }
});

// AI ensemble status endpoint
app.get('/api/ai/status', (req, res) => {
  try {
    const ensembleStatus = aiEnsemble.getStatus();
    res.json({
      success: true,
      ensemble: ensembleStatus,
      router: modelRouter.getStats(),
      mode: systemStatus.mode,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI status error:', error);
    res.status(500).json({ error: 'Failed to get AI status' });
  }
});

// Helper functions
async function checkOpenRouterHealth() {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      console.log('OpenRouter API key not configured');
      return false;
    }

    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    console.log('OpenRouter health check: SUCCESS');
    return response.status === 200;
  } catch (error) {
    console.error('OpenRouter health check failed:', error.message);
    return false;
  }
}

async function checkTwitterHealth() {
  try {
    if (!process.env.TWITTER_API_KEY) {
      console.log('Twitter API key not configured');
      return false;
    }

    const response = await axios.get('https://api.twitterapi.io/v2/users/by/username/elonmusk', {
      headers: {
        'Authorization': `Bearer ${process.env.TWITTER_API_KEY}`
      },
      timeout: 5000
    });

    console.log('Twitter health check: SUCCESS');
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
  console.log(`🎯 System Mode: PRODUCTION (Demo mode disabled)`);
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
