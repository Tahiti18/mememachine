export interface ProcessedTweet {
  id: string;
  content: string;
  author: string;
  timestamp: Date;
  metrics: {
    likes: number;
    retweets: number;
    views: number;
  };
  metadata: {
    isInfluencer: boolean;
    followersCount: number;
    verifiedAccount: boolean;
  };
}

export interface SentimentAnalysis {
  tweetId: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-1
  marketRelevance: number; // 0-1
  emotionalIntensity: number; // 0-1
  keyPhrases: string[];
  marketSignals: {
    mentionsTicker: boolean;
    mentionsPump: boolean;
    mentionsMoon: boolean;
    mentionsAltcoin: boolean;
    mentionsRocket: boolean;
  };
  aiReasoning: string;
  processedAt: Date;
}

export interface TokenSuggestion {
  name: string;
  symbol: string;
  description: string;
  theme: string;
  marketCap: number;
  confidence: number;
  reasoning: string;
  basedOnTweet: string;
  suggestedAt: Date;
}

export interface OpenAIAnalysisRequest {
  tweet: ProcessedTweet;
  context?: {
    recentTrends?: string[];
    marketConditions?: string;
    authorHistory?: string;
  };
}

export interface OpenAIAnalysisResponse {
  sentiment: SentimentAnalysis;
  tokenSuggestion?: TokenSuggestion;
  shouldCreateToken: boolean;
  urgencyScore: number; // 0-1
}

export interface CostAnalytics {
  totalTokensUsed: number;
  totalCost: number;
  requestCount: number;
  averageCostPerRequest: number;
  budgetUsage: number; // percentage
  estimatedDailyCost: number;
  lastReset: Date;
}

export interface ServiceStatus {
  isActive: boolean;
  redisConnected: boolean;
  openaiConnected: boolean;
  processingQueue: number;
  costAnalytics: CostAnalytics;
  lastProcessedTweet?: Date;
  errorCount: number;
  uptime: number;
}

export interface AIConfiguration {
  model: string;
  maxTokens: number;
  temperature: number;
  enableTokenSuggestions: boolean;
  minMarketRelevance: number;
  minConfidence: number;
  enableBatchProcessing: boolean;
  maxBatchSize: number;
}
