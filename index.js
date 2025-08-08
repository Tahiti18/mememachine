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
