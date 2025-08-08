const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

console.log('🚀 Meme Coin Automation Platform Starting...');
console.log('📍 Current directory:', __dirname);
console.log('🌐 Port:', port);

// Root endpoint
app.get('/', (req, res) => {
    console.log('📊 Root endpoint accessed');
    res.json({
        status: 'SUCCESS',
        message: '🚀 Meme Coin Automation Platform is RUNNING!',
        timestamp: new Date().toISOString(),
        port: port,
        environment: process.env.NODE_ENV || 'development',
        uptime: `${Math.floor(process.uptime())} seconds`
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: process.platform,
        nodeVersion: process.version
    };
    
    console.log('🏥 Health check:', healthData.status);
    res.json(healthData);
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        api: 'online',
        services: {
            'social-monitor': 'initializing',
            'sentiment-ai': 'initializing', 
            'token-creator': 'initializing',
            'website-generator': 'ready',
            'trading-agent': 'ready',
            'cost-manager': 'ready'
        },
        message: 'Meme coin automation services starting up...'
    });
});

// Start the server
app.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('❌ Server failed to start:', err);
        process.exit(1);
    }
    
    console.log('✅ SUCCESS! Server is running!');
    console.log(`🌐 Server URL: http://localhost:${port}`);
    console.log(`🔗 Railway URL will be: https://your-app.railway.app`);
    console.log('📊 Endpoints available:');
    console.log('   GET / - Main status');
    console.log('   GET /health - Health check');
    console.log('   GET /api/status - API status');
    console.log('🎯 Ready to receive requests!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Received SIGTERM, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 Received SIGINT, shutting down gracefully');
    process.exit(0);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    process.exit(1);
});

console.log('🎯 Meme Coin Platform initialization complete!');
