# 🚀 Meme Coin Automation Platform MVP

## 💡 Overview

An intelligent, cost-optimized platform that monitors influential Twitter accounts and automatically launches meme coins on Solana based on market-moving tweets. Built for maximum ROI with minimal startup costs.

### 🎯 Key Features
- **Ultra-Low Cost Start**: Begin at just $25-50/month
- **Intelligent Scaling**: Seamlessly upgrade from MVP to enterprise
- **Multi-Provider Support**: TwitterAPI.io → RapidAPI → Official Twitter API
- **Automated Everything**: Tweet monitoring → Sentiment analysis → Token creation → Website deployment → Trading setup
- **Smart Budget Management**: Real-time cost tracking with auto-throttling

## 💰 Cost-Effective Architecture

### MVP Tier ($25-50/month)
```yaml
Twitter Data: TwitterAPI.io ($15-30/month)
AI Analysis: OpenAI Basic ($10-20/month)
Infrastructure: Free/cheap tiers
Monitoring: 5 key influencers
Update Interval: 5 minutes
Monthly Tokens: 50-100 potential launches
```

### Growth Tier ($200-500/month)
```yaml
Twitter Data: X API Basic ($200/month)
Enhanced AI: Advanced models ($50-100/month)
Infrastructure: Production ready ($50-200/month)
Monitoring: 50+ influencers
Update Interval: 1 minute
Monthly Tokens: 500+ potential launches
```

### Enterprise Tier ($2000-5000/month)
```yaml
Twitter Data: X API Pro ($5000/month)
Full AI Suite: Multi-model analysis
Infrastructure: Enterprise scale
Monitoring: Unlimited influencers
Update Interval: Real-time streaming
Monthly Tokens: Unlimited
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Docker and Docker Compose
- Git

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd meme-coin-automation-platform
cp .env.example .env
# Edit .env with your API keys (see Configuration section)
```

### 2. Install Dependencies
```bash
npm run install:all
```

### 3. Start Development Environment
```bash
docker-compose up -d
npm run dev
```

### 4. Access Services
- Admin Dashboard: http://localhost:3000
- API Gateway: http://localhost:4000
- Social Monitor: http://localhost:3001
- Sentiment AI: http://localhost:3002
- Token Creator: http://localhost:3003
- Website Generator: http://localhost:3004
- Trading Agent: http://localhost:3005

## ⚙️ Configuration

### Required Environment Variables

```env
# === COST-EFFECTIVE APIs (MVP Tier) ===

# TwitterAPI.io (Primary - $15-30/month)
TWITTERAPI_IO_KEY=your_api_key
TWITTERAPI_IO_HOST=https://api.twitterapi.io

# OpenAI (Basic tier - $10-20/month)
OPENAI_API_KEY=your_openai_key

# Solana Network
SOLANA_RPC_URL=https://api.devnet.solana.com  # Free for testing
SOLANA_WALLET_PRIVATE_KEY=your_wallet_private_key

# === OPTIONAL UPGRADE APIS ===

# X/Twitter Official API (for scaling)
TWITTER_BEARER_TOKEN=your_bearer_token
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret

# RapidAPI (Alternative provider)
RAPIDAPI_KEY=your_rapidapi_key

# === BUDGET CONTROLS ===
MONTHLY_BUDGET_LIMIT=50  # USD
AUTO_THROTTLE_AT_PERCENT=80  # Slow down at 80% budget usage
EMERGENCY_STOP_AT_PERCENT=95  # Stop processing at 95% budget

# === INFLUENCER CONFIGURATION ===
MONITORED_ACCOUNTS=elonmusk,VitalikButerin,cz_binance,SBF_FTX,justinsuntron
POLLING_INTERVAL_MINUTES=5  # Start with 5min, upgrade to 1min or real-time
```

## 🚀 Ready to revolutionize meme coin creation? Start with just $25/month and scale to the moon! 🌙
