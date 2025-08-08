#!/bin/bash

echo "🚀 Starting Meme Coin Automation Platform..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env file with your API keys and configuration"
    echo "🔑 Required: TWITTER_API_KEY, OPENAI_API_KEY, SOLANA_PRIVATE_KEY"
    exit 1
fi

echo "📦 Building and starting all services..."

# Build and start services
docker-compose up --build -d

echo "⏳ Waiting for services to be healthy..."
sleep 30

# Check service health
services=("social-monitor:3001" "sentiment-ai:3002" "token-creator:3003" "website-generator:3004" "trading-agent:3005" "cost-manager:3006")

for service in "${services[@]}"; do
    if curl -f "http://localhost:${service#*:}/health" > /dev/null 2>&1; then
        echo "✅ ${service%:*} is healthy"
    else
        echo "❌ ${service%:*} is not responding"
    fi
done

echo ""
echo "🎉 Meme Coin Automation Platform is running!"
echo ""
echo "📊 Service URLs:"
echo "  • Social Monitor:     http://localhost:3001"
echo "  • Sentiment AI:       http://localhost:3002" 
echo "  • Token Creator:      http://localhost:3003"
echo "  • Website Generator:  http://localhost:3004"
echo "  • Trading Agent:      http://localhost:3005"
echo "  • Cost Manager:       http://localhost:3006"
echo "  • Grafana Dashboard:  http://localhost:3000 (admin/admin123)"
echo "  • Prometheus:         http://localhost:9090"
echo ""
echo "📝 Logs: docker-compose logs -f [service-name]"
echo "🛑 Stop: docker-compose down"
echo ""
