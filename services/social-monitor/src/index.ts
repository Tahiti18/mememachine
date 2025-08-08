import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from 'redis';
import { SocialMediaMonitor } from './providers/SocialMediaMonitor';
import { CostManager } from './utils/CostManager';
import { Logger } from './utils/Logger';
import { TwitterAPIProvider } from './providers/TwitterAPIProvider';
import { RapidAPIProvider } from './providers/RapidAPIProvider';
import { OfficialTwitterProvider } from './providers/OfficialTwitterProvider';

dotenv.config();

const app = express();
const PORT = process.env.SOCIAL_MONITOR_PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Global instances
let redisClient: any;
let socialMonitor: SocialMediaMonitor;
let costManager: CostManager;

/**
 * Initialize Redis connection with retry logic
 */
async function initializeRedis(): Promise<void> {
  try {
    redisClient = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on('error', (err: Error) => {
      Logger.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      Logger.info('Connected to Redis successfully');
    });

    await redisClient.connect();
  } catch (error) {
    Logger.error('Failed to initialize Redis:', error);
    throw error;
  }
}

/**
 * Initialize Social Media Monitor with cost-optimized providers
 */
async function initializeMonitor(): Promise<void> {
  try {
    // Initialize cost manager with budget controls
    costManager = new CostManager({
      monthlyBudget: parseFloat(process.env.MONTHLY_BUDGET_LIMIT || '50'),
      autoThrottleAt: parseFloat(process.env.AUTO_THROTTLE_AT_PERCENT || '80'),
      emergencyStopAt: parseFloat(process.env.EMERGENCY_STOP_AT_PERCENT || '95'),
      redisClient,
    });

    // Initialize API providers in order of cost-effectiveness
    const providers = [];

    // Primary: TwitterAPI.io (Most cost-effective)
    if (process.env.TWITTERAPI_IO_KEY) {
      providers.push(new TwitterAPIProvider({
        apiKey: process.env.TWITTERAPI_IO_KEY,
        host: process.env.TWITTERAPI_IO_HOST || 'https://api.twitterapi.io',
        rateLimit: parseInt(process.env.TWITTERAPI_IO_RATE_LIMIT || '1000'),
        costPerRequest: 0.00015, // $0.15 per 1K requests
      }));
    }

    // Secondary: RapidAPI (Fallback)
    if (process.env.RAPIDAPI_KEY) {
      providers.push(new RapidAPIProvider({
        apiKey: process.env.RAPIDAPI_KEY,
        host: process.env.RAPIDAPI_HOST || 'twttr-api.p.rapidapi.com',
        costPerRequest: 0.001,
      }));
    }

    // Tertiary: Official Twitter API (For scaling)
    if (process.env.TWITTER_BEARER_TOKEN) {
      providers.push(new OfficialTwitterProvider({
        bearerToken: process.env.TWITTER_BEARER_TOKEN,
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        costPerRequest: 0.013, // Based on $200/month for 15K requests
      }));
    }

    if (providers.length === 0) {
      throw new Error('No API providers configured. Please set up at least TwitterAPI.io credentials.');
    }

    // Initialize monitor with providers
    socialMonitor = new SocialMediaMonitor({
      providers,
      costManager,
      redisClient,
      monitoredAccounts: (process.env.MONITORED_ACCOUNTS || 'elonmusk').split(',').map(acc => acc.trim()),
      pollingIntervalMinutes: parseInt(process.env.POLLING_INTERVAL_MINUTES || '5'),
      sentimentThreshold: parseFloat(process.env.SENTIMENT_THRESHOLD || '0.85'),
      maxTokensPerDay: parseInt(process.env.MAX_TOKENS_PER_DAY || '5'),
    });

    Logger.info(`Social Monitor initialized with ${providers.length} providers`);
    Logger.info(`Monitoring accounts: ${process.env.MONITORED_ACCOUNTS}`);
    Logger.info(`Polling interval: ${process.env.POLLING_INTERVAL_MINUTES} minutes`);
    Logger.info(`Monthly budget: $${process.env.MONTHLY_BUDGET_LIMIT}`);

  } catch (error) {
    Logger.error('Failed to initialize Social Monitor:', error);
    throw error;
  }
}

/**
 * API Routes
 */

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'social-monitor',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Get current monitoring status
app.get('/status', async (req, res) => {
  try {
    const status = await socialMonitor.getStatus();
    const costStatus = await costManager.getCurrentUsage();

    res.json({
      monitoring: status,
      costs: costStatus,
      providers: await socialMonitor.getProviderStatus(),
    });
  } catch (error) {
    Logger.error('Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Get recent tweets
app.get('/tweets/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const tweets = await socialMonitor.getRecentTweets(limit);
    res.json(tweets);
  } catch (error) {
    Logger.error('Error fetching recent tweets:', error);
    res.status(500).json({ error: 'Failed to fetch tweets' });
  }
});

// Get cost analytics
app.get('/analytics/costs', async (req, res) => {
  try {
    const analytics = await costManager.getAnalytics();
    res.json(analytics);
  } catch (error) {
    Logger.error('Error fetching cost analytics:', error);
    res.status(500).json({ error: 'Failed to fetch cost analytics' });
  }
});

// Manual trigger for testing
app.post('/trigger/scan', async (req, res) => {
  try {
    const result = await socialMonitor.performManualScan();
    res.json({ message: 'Manual scan triggered', result });
  } catch (error) {
    Logger.error('Error triggering manual scan:', error);
    res.status(500).json({ error: 'Failed to trigger scan' });
  }
});

// Update monitoring configuration
app.post('/config/update', async (req, res) => {
  try {
    const { accounts, pollingInterval, sentimentThreshold } = req.body;
    await socialMonitor.updateConfig({
      monitoredAccounts: accounts,
      pollingIntervalMinutes: pollingInterval,
      sentimentThreshold,
    });
    res.json({ message: 'Configuration updated successfully' });
  } catch (error) {
    Logger.error('Error updating configuration:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * Error handling middleware
 */
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  Logger.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', async () => {
  Logger.info('Received SIGTERM, shutting down gracefully...');

  if (socialMonitor) {
    await socialMonitor.stop();
  }

  if (redisClient) {
    await redisClient.disconnect();
  }

  process.exit(0);
});

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    await initializeRedis();
    await initializeMonitor();

    // Start monitoring
    await socialMonitor.start();

    app.listen(PORT, () => {
      Logger.info(`🚀 Social Monitor Service running on port ${PORT}`);
      Logger.info(`📊 Dashboard: http://localhost:${PORT}/status`);
      Logger.info(`💰 Budget: $${process.env.MONTHLY_BUDGET_LIMIT}/month`);
      Logger.info(`⏱️  Polling: ${process.env.POLLING_INTERVAL_MINUTES} minutes`);
    });

  } catch (error) {
    Logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  Logger.error('Unhandled startup error:', error);
  process.exit(1);
});

export { app };
