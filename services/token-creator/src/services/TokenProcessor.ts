import { Redis } from 'redis';
import { SolanaService } from './SolanaService';
import { TokenSuggestion, TokenCreationRequest, TokenMetadata, ServiceStatus, GeneratedImage, ImageGenerationRequest } from '../types';

export class TokenProcessor {
  private redis: Redis;
  private solanaService: SolanaService;
  private isProcessing = false;
  private tokensCreated = 0;
  private errorCount = 0;
  private startTime = Date.now();

  constructor(redis: Redis) {
    this.redis = redis;
    this.solanaService = new SolanaService(redis);
  }

  async startProcessing(): Promise<void> {
    console.log('🪙 Starting token processor...');

    await this.redis.subscribe('token_suggestions', (message) => {
      this.processTokenSuggestion(message);
    });

    this.isProcessing = true;
    console.log('✅ Token processor active and listening');
  }

  private async processTokenSuggestion(message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      const suggestion: TokenSuggestion = data.suggestion;

      if (suggestion.confidence < parseFloat(process.env.MIN_TOKEN_CONFIDENCE || '0.8')) {
        console.log(\`Token suggestion confidence too low: \${suggestion.confidence}\`);
        return;
      }

      // Check daily limits
      if (await this.checkDailyLimits()) {
        console.log('Daily token creation limit reached');
        return;
      }

      console.log(\`🚀 Processing token suggestion: \${suggestion.name} (\${suggestion.symbol})\`);

      // Generate metadata and image
      const metadata = await this.generateTokenMetadata(suggestion);
      const image = await this.generateTokenImage(suggestion);

      // Create token request
      const request: TokenCreationRequest = {
        tokenSuggestion: suggestion,
        metadata: { ...metadata, image: image.buffer.toString('base64') },
        initialSupply: parseInt(process.env.DEFAULT_TOKEN_SUPPLY || '1000000000'),
        decimals: parseInt(process.env.DEFAULT_DECIMALS || '6'),
        enableMinting: false,
        enableFreezing: false,
        uploadToIPFS: true
      };

      // Create token
      const result = await this.solanaService.createToken(request);

      if (result.status === 'created') {
        this.tokensCreated++;
        console.log(\`✅ Token \${suggestion.symbol} created: \${result.mintAddress}\`);

        // Deploy to pump.fun if enabled
        if (process.env.ENABLE_PUMP_FUN === 'true') {
          await this.solanaService.deployToPumpFun(result, metadata);
        }

        // Publish success event
        await this.redis.publish('token_created', JSON.stringify({
          result,
          suggestion,
          timestamp: new Date().toISOString()
        }));
      } else {
        this.errorCount++;
        console.error(\`❌ Token creation failed: \${result.error}\`);
      }

    } catch (error) {
      console.error('Failed to process token suggestion:', error);
      this.errorCount++;
    }
  }

  private async generateTokenMetadata(suggestion: TokenSuggestion): Promise<TokenMetadata> {
    return {
      name: suggestion.name,
      symbol: suggestion.symbol,
      description: suggestion.description,
      image: '', // Will be filled by image generation
      attributes: [
        { trait_type: 'Theme', value: suggestion.theme },
        { trait_type: 'Confidence', value: suggestion.confidence.toString() },
        { trait_type: 'Based On Tweet', value: suggestion.basedOnTweet }
      ]
    };
  }

  private async generateTokenImage(suggestion: TokenSuggestion): Promise<GeneratedImage> {
    // Simple mock image generation - replace with actual AI image generation
    const canvas = require('canvas');
    const canvasInstance = canvas.createCanvas(400, 400);
    const ctx = canvasInstance.getContext('2d');

    // Create simple gradient background
    const gradient = ctx.createLinearGradient(0, 0, 400, 400);
    gradient.addColorStop(0, '#FF6B6B');
    gradient.addColorStop(1, '#4ECDC4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 400);

    // Add text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(suggestion.symbol, 200, 200);

    const buffer = canvasInstance.toBuffer('image/png');

    return {
      buffer,
      format: 'png',
      width: 400,
      height: 400,
      size: buffer.length,
      metadata: {
        theme: suggestion.theme,
        style: 'meme',
        colors: ['#FF6B6B', '#4ECDC4']
      }
    };
  }

  private async checkDailyLimits(): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = await this.redis.get(\`daily_tokens:\${today}\`) || '0';
    const maxDaily = parseInt(process.env.MAX_DAILY_TOKENS || '10');

    return parseInt(dailyCount) >= maxDaily;
  }

  async getServiceStatus(): Promise<ServiceStatus> {
    const balance = await this.solanaService.getWalletBalance();
    const solanaConnected = await this.solanaService.checkConnection();

    return {
      isActive: this.isProcessing,
      redisConnected: this.redis.isOpen,
      solanaConnected,
      walletBalance: balance,
      tokensCreated: this.tokensCreated,
      successRate: this.tokensCreated / Math.max(this.tokensCreated + this.errorCount, 1),
      avgCreationTime: 30000, // Mock value
      costAnalytics: {
        totalCosts: 0.1 * this.tokensCreated, // Mock
        avgCostPerToken: 0.1,
        budgetUsage: 50
      },
      lastTokenCreated: this.tokensCreated > 0 ? new Date() : undefined,
      errorCount: this.errorCount,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  async stop(): Promise<void> {
    this.isProcessing = false;
    console.log('🛑 Token processor stopped');
  }
}
