import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createClient } from 'redis';

const app = express();
const PORT = process.env.PORT || 3006;

app.use(helmet());
app.use(cors());
app.use(express.json());

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

async function initialize() {
  await redis.connect();
  console.log('💰 Cost Manager service initialized');
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'cost-manager' });
});

app.listen(PORT, async () => {
  console.log(`💰 Cost Manager running on port ${PORT}`);
  await initialize();
});
