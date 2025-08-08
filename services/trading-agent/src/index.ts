import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createClient } from 'redis';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(helmet());
app.use(cors());
app.use(express.json());

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

async function initialize() {
  await redis.connect();
  console.log('📈 Trading Agent service initialized');
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'trading-agent' });
});

app.listen(PORT, async () => {
  console.log(`📈 Trading Agent running on port ${PORT}`);
  await initialize();
});
