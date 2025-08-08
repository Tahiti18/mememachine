import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createClient } from 'redis';
import { TokenProcessor } from './services/TokenProcessor';

const app = express();
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

let tokenProcessor: TokenProcessor;

async function initialize() {
  try {
    await redis.connect();
    console.log('✅ Redis connected');

    tokenProcessor = new TokenProcessor(redis);
    await tokenProcessor.startProcessing();

    console.log('🪙 Token Creator service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize token creator service:', error);
    process.exit(1);
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'token-creator',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/status', async (req, res) => {
  try {
    if (!tokenProcessor) {
      return res.status(503).json({ error: 'Service not initialized' });
    }

    const status = await tokenProcessor.getServiceStatus();
    res.json({
      service: 'token-creator',
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

app.get('/tokens', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const tokens = await redis.lRange('created_tokens', 0, parseInt(limit as string) - 1);

    const tokenDetails = await Promise.all(
      tokens.map(async (mintAddress) => {
        const data = await redis.get(\`token_created:\${mintAddress}\`);
        return data ? JSON.parse(data) : null;
      })
    );

    res.json({
      count: tokenDetails.filter(t => t !== null).length,
      tokens: tokenDetails.filter(t => t !== null)
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get tokens',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down token creator service...');

  if (tokenProcessor) {
    await tokenProcessor.stop();
  }

  if (redis.isOpen) {
    await redis.quit();
  }

  process.exit(0);
});

app.listen(PORT, async () => {
  console.log(\`🚀 Token Creator service running on port \${PORT}\`);
  await initialize();
});

export { app, redis };
