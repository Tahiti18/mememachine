import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createClient } from 'redis';
import { SentimentProcessor } from './services/SentimentProcessor';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Redis client
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

let sentimentProcessor: SentimentProcessor;

// Initialize services
async function initialize() {
  try {
    // Connect to Redis
    await redis.connect();
    console.log('✅ Redis connected');

    // Initialize sentiment processor
    sentimentProcessor = new SentimentProcessor(redis);
    await sentimentProcessor.startProcessing();

    console.log('🎯 Sentiment AI service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize sentiment AI service:', error);
    process.exit(1);
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'sentiment-ai',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/status', async (req, res) => {
  try {
    if (!sentimentProcessor) {
      return res.status(503).json({
        error: 'Service not initialized',
        status: 'unavailable'
      });
    }

    const status = await sentimentProcessor.getServiceStatus();
    res.json({
      service: 'sentiment-ai',
      ...status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get service status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/analytics/sentiment', async (req, res) => {
  try {
    const { limit = 10, sentiment } = req.query;

    let sentimentKey = 'high_relevance_sentiment';
    if (sentiment && ['bullish', 'bearish', 'neutral'].includes(sentiment as string)) {
      sentimentKey = `sentiment_${sentiment}`;
    }

    const results = sentiment === 'high_relevance' 
      ? await redis.zRange(sentimentKey, 0, parseInt(limit as string) - 1, { REV: true })
      : await redis.lRange(sentimentKey, 0, parseInt(limit as string) - 1);

    const analyses = await Promise.all(
      results.map(async (tweetId) => {
        try {
          const analysisData = await redis.get(`sentiment_analysis:${tweetId}`);
          return analysisData ? JSON.parse(analysisData) : null;
        } catch {
          return null;
        }
      })
    );

    res.json({
      sentiment: sentiment || 'all',
      count: analyses.filter(a => a !== null).length,
      analyses: analyses.filter(a => a !== null)
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get sentiment analytics',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/analytics/tokens/suggestions', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get high-confidence token suggestions
    const suggestions = await redis.zRange(
      'token_suggestions_by_confidence',
      0,
      parseInt(limit as string) - 1,
      { REV: true }
    );

    const tokenSuggestions = await Promise.all(
      suggestions.map(async (suggestionId) => {
        try {
          const data = await redis.get(`token_suggestion:${suggestionId}`);
          return data ? JSON.parse(data) : null;
        } catch {
          return null;
        }
      })
    );

    res.json({
      count: tokenSuggestions.filter(s => s !== null).length,
      suggestions: tokenSuggestions.filter(s => s !== null)
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get token suggestions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/process/backlog', async (req, res) => {
  try {
    if (!sentimentProcessor) {
      return res.status(503).json({
        error: 'Service not initialized'
      });
    }

    await sentimentProcessor.processBacklog();
    res.json({
      message: 'Backlog processing started',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to process backlog',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/analytics/costs', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `ai_usage:${today}`;

    const usage = await redis.hGetAll(usageKey);
    const dailyBudget = parseFloat(process.env.DAILY_AI_BUDGET || '10');

    const analytics = {
      totalTokensUsed: parseInt(usage.total_tokens || '0'),
      totalCost: parseFloat(usage.total_cost || '0'),
      requestCount: parseInt(usage.request_count || '0'),
      averageCostPerRequest: parseInt(usage.request_count || '0') > 0 
        ? parseFloat(usage.total_cost || '0') / parseInt(usage.request_count || '0') 
        : 0,
      budgetUsage: (parseFloat(usage.total_cost || '0') / dailyBudget) * 100,
      dailyBudget,
      averageResponseTime: parseInt(usage.request_count || '0') > 0
        ? parseInt(usage.total_response_time || '0') / parseInt(usage.request_count || '0')
        : 0,
      date: today
    };

    res.json(analytics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cost analytics',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handling
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down sentiment AI service...');

  if (sentimentProcessor) {
    await sentimentProcessor.stop();
  }

  if (redis.isOpen) {
    await redis.quit();
  }

  process.exit(0);
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Sentiment AI service running on port ${PORT}`);
  await initialize();
});

export { app, redis };
