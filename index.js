const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'SUCCESS',
    message: '🚀 Meme Coin Automation Platform is RUNNING!',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'production',
    uptime: `${process.uptime()} seconds`
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// API endpoints (basic responses for now)
app.get('/api/status', (req, res) => {
  res.json({
    platform: 'Meme Coin Automation',
    status: 'online',
    mode: 'bridge-mode',
    message: 'Platform ready for services integration'
  });
});

app.get('/api/tweets', (req, res) => {
  res.json({
    status: 'success',
    message: 'Tweet monitoring service ready (services files pending)',
    data: []
  });
});

app.get('/api/analysis', (req, res) => {
  res.json({
    status: 'success',
    message: 'Analysis service ready (services files pending)',
    data: {
      sentiment: 'ready',
      ensemble: 'pending services files'
    }
  });
});

// Environment Variables Test Endpoint
app.get('/test/config', (req, res) => {
  const maskApiKey = (key) => {
    if (!key) return 'NOT_SET';
    return key.substring(0, 10) + '...' + key.substring(key.length - 6);
  };

  res.json({
    timestamp: new Date().toISOString(),
    environment_variables: {
      openrouter_key: process.env.OPENROUTER_API_KEY ? '✅ SET' : '❌ MISSING',
      openrouter_masked: maskApiKey(process.env.OPENROUTER_API_KEY),
      twitter_key: process.env.TWITTER_API_KEY ? '✅ SET' : '❌ MISSING', 
      twitter_masked: maskApiKey(process.env.TWITTER_API_KEY),
      ensemble_mode: process.env.AI_ENSEMBLE_MODE || '❌ NOT_SET',
      confidence_threshold: process.env.CONFIDENCE_THRESHOLD || '❌ NOT_SET',
      voting_method: process.env.ENSEMBLE_VOTING || '❌ NOT_SET'
    },
    models: {
      primary: process.env.PRIMARY_MODEL || '❌ NOT_SET',
      secondary: process.env.SECONDARY_MODEL || '❌ NOT_SET',
      premium: process.env.PREMIUM_MODEL || '❌ NOT_SET', 
      backup: process.env.BACKUP_MODEL || '❌ NOT_SET'
    },
    system_status: {
      platform: 'Bridge Mode Active',
      apis_configured: (process.env.OPENROUTER_API_KEY && process.env.TWITTER_API_KEY) ? '✅ READY' : '❌ INCOMPLETE',
      next_step: 'Upload services files for full activation'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    path: req.path
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Meme Coin Platform Bridge Mode running on port ${PORT}`);
  console.log(`📡 Ready to accept services integration`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'production'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
