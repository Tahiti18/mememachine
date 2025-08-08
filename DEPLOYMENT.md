# 🚀 Meme Coin Automation Platform - Deployment Guide

## Prerequisites

- Docker & Docker Compose installed
- Node.js 18+ (for local development)
- API Keys:
  - TwitterAPI.io or RapidAPI key
  - OpenAI API key
  - Solana wallet private key

## Quick Start (Recommended)

### 1. Clone and Setup
```bash
# Extract the ZIP file
unzip meme-coin-automation-platform.zip
cd meme-coin-automation-platform

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment Variables
Edit `.env` file with your API keys:

```bash
# Required - TwitterAPI.io (Cost-effective option)
TWITTER_API_KEY=your_twitterapi_io_key
RAPIDAPI_KEY=your_rapidapi_key

# Required - OpenAI
OPENAI_API_KEY=your_openai_key

# Required - Solana Wallet (JSON array format)
SOLANA_PRIVATE_KEY=[1,2,3,...,64] # Your wallet's secret key
SOLANA_RPC_URL=https://api.devnet.solana.com # or mainnet

# Budget Controls
DAILY_BUDGET=25
DAILY_AI_BUDGET=10
```

### 3. Start the Platform
```bash
# Use the automated startup script
./start.sh

# OR manually with docker-compose
docker-compose up --build -d
```

### 4. Verify Services
```bash
# Check all services are running
docker-compose ps

# View logs
docker-compose logs -f
```

## Service Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Social Monitor │───▶│  Sentiment AI   │───▶│ Token Creator   │
│   (Port 3001)   │    │   (Port 3002)   │    │   (Port 3003)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│Website Generator│    │ Trading Agent   │    │  Cost Manager   │
│   (Port 3004)   │    │   (Port 3005)   │    │   (Port 3006)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                        ┌─────────────────┐
                        │      Redis      │
                        │   (Port 6379)   │
                        └─────────────────┘
```

## Cost Optimization

### MVP Tier ($25-50/month)
- TwitterAPI.io: $15/month (500K requests)
- OpenAI GPT-3.5-turbo: $10/month
- Hosting: Free (local) or $10-25 (cloud)

### Growth Tier ($200-500/month)
- Multiple Twitter APIs for redundancy
- GPT-4 for enhanced analysis
- Cloud hosting with auto-scaling
- Monitoring and analytics

## Monitoring & Analytics

- **Grafana Dashboard**: http://localhost:3000
- **Prometheus Metrics**: http://localhost:9090
- **Service Health**: http://localhost:300X/health (where X is service port)

## Scaling Options

### Docker Swarm (Simple Scaling)
```bash
docker swarm init
docker stack deploy -c docker-compose.yml meme-platform
```

### Kubernetes (Advanced Scaling)
```bash
# Apply Kubernetes manifests (included in /k8s directory)
kubectl apply -f k8s/
```

### Cloud Deployment

#### AWS ECS
1. Push images to ECR
2. Create ECS task definitions
3. Deploy services to ECS cluster

#### Google Cloud Run
1. Build containers: `docker-compose build`
2. Push to GCR: `docker push gcr.io/PROJECT/service`
3. Deploy: `gcloud run deploy`

#### DigitalOcean App Platform
1. Connect GitHub repository
2. Configure build settings
3. Set environment variables
4. Deploy

## API Endpoints

### Social Monitor (3001)
- `GET /health` - Health check
- `GET /status` - Service status and metrics
- `GET /tweets` - Recent monitored tweets
- `POST /scan` - Manual tweet scan
- `GET /analytics/costs` - Cost breakdown

### Sentiment AI (3002)
- `GET /health` - Health check
- `GET /status` - Service status
- `GET /analytics/sentiment` - Sentiment analysis results
- `GET /analytics/tokens/suggestions` - Token suggestions
- `POST /process/backlog` - Process tweet backlog

### Token Creator (3003)
- `GET /health` - Health check  
- `GET /status` - Service status including wallet balance
- `GET /tokens` - Created tokens list
- `POST /create` - Manual token creation

## Security Best Practices

1. **API Keys**: Never commit to version control
2. **Wallet Security**: Use hardware wallets for mainnet
3. **Rate Limiting**: Configure appropriate limits
4. **Budget Controls**: Set strict daily/monthly limits
5. **Network Security**: Use VPC/private networks in production

## Troubleshooting

### Common Issues

1. **Service Not Starting**
   ```bash
   docker-compose logs service-name
   ```

2. **API Rate Limits**
   - Check cost analytics endpoints
   - Verify budget settings
   - Consider upgrading API tiers

3. **Solana Connection Issues**
   - Verify RPC URL is accessible
   - Check wallet has sufficient SOL
   - Confirm network (devnet/mainnet)

4. **Redis Connection Errors**
   ```bash
   docker-compose restart redis
   ```

## Development

### Local Development Setup
```bash
# Install dependencies for all services
npm run install:all

# Start in development mode
npm run dev

# Run tests
npm run test
```

### Adding New Features
1. Create feature branch
2. Add service code
3. Update docker-compose if needed
4. Add tests
5. Update documentation

## Support & Updates

- GitHub Issues: Report bugs and feature requests
- Documentation: Check README files in each service
- Logs: Use `docker-compose logs` for debugging
- Metrics: Monitor via Grafana dashboards

---

**Happy Meme Coin Automation! 🚀🪙**
