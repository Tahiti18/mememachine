// Type definitions for Social Monitor Service

export interface Tweet {
  id: string;
  text: string;
  author: string;
  authorId: string;
  createdAt: Date;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  entities?: {
    hashtags?: string[];
    mentions?: string[];
    urls?: string[];
  };
  isRetweet: boolean;
  originalTweetId?: string;
  language?: string;
}

export interface ProcessedTweet extends Tweet {
  sentimentScore: number;
  marketImpactScore: number;
  viralPotential: number;
  confidence: number;
  keywords: string[];
  processingTimestamp: Date;
  provider: string;
}

export interface APIProvider {
  name: string;
  costPerRequest: number;
  rateLimit: number;
  isActive: boolean;
  lastUsed?: Date;
  requestsThisMonth: number;
  costThisMonth: number;
}

export interface TwitterAPIProviderConfig {
  apiKey: string;
  host: string;
  rateLimit: number;
  costPerRequest: number;
}

export interface RapidAPIProviderConfig {
  apiKey: string;
  host: string;
  costPerRequest: number;
}

export interface OfficialTwitterProviderConfig {
  bearerToken: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  costPerRequest: number;
}

export interface MonitoringConfig {
  monitoredAccounts: string[];
  pollingIntervalMinutes: number;
  sentimentThreshold: number;
  maxTokensPerDay: number;
}

export interface CostManagerConfig {
  monthlyBudget: number;
  autoThrottleAt: number;
  emergencyStopAt: number;
  redisClient: any;
}

export interface CostAnalytics {
  currentMonth: {
    totalCost: number;
    requestsCount: number;
    averageCostPerRequest: number;
    budgetUsedPercent: number;
    remainingBudget: number;
  };
  providers: {
    [providerName: string]: {
      cost: number;
      requests: number;
      percentage: number;
    };
  };
  dailyBreakdown: {
    date: string;
    cost: number;
    requests: number;
  }[];
  projectedMonthlyUsage: {
    estimatedTotalCost: number;
    estimatedRequests: number;
    willExceedBudget: boolean;
  };
}

export interface MonitorStatus {
  isRunning: boolean;
  lastScanTime?: Date;
  nextScanTime?: Date;
  tweetsProcessedToday: number;
  tokensCreatedToday: number;
  errors: {
    count: number;
    lastError?: string;
    lastErrorTime?: Date;
  };
  performance: {
    averageProcessingTime: number;
    successRate: number;
  };
}

export interface SocialMediaMonitorConfig {
  providers: any[];
  costManager: any;
  redisClient: any;
  monitoredAccounts: string[];
  pollingIntervalMinutes: number;
  sentimentThreshold: number;
  maxTokensPerDay: number;
}

export interface MarketSignal {
  tweetId: string;
  tweet: ProcessedTweet;
  signalStrength: number;
  recommendedAction: 'CREATE_TOKEN' | 'MONITOR' | 'IGNORE';
  tokenNameSuggestion?: string;
  reasoning: string;
  timestamp: Date;
}

export interface ProviderStatus {
  name: string;
  isActive: boolean;
  costThisMonth: number;
  requestsThisMonth: number;
  lastUsed?: Date;
  rateLimit: {
    remaining: number;
    resetTime?: Date;
  };
  health: 'healthy' | 'degraded' | 'down';
  responseTime: number;
}

export interface RedisEventData {
  type: 'TWEET_DETECTED' | 'SENTIMENT_ANALYZED' | 'SIGNAL_GENERATED' | 'COST_ALERT';
  data: any;
  timestamp: Date;
  source: string;
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

export interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: Date;
  service: string;
  metadata?: Record<string, any>;
}

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetTime: Date;
  windowStart: Date;
}

export interface APIResponse<T> {
  data: T;
  success: boolean;
  error?: string;
  rateLimitStatus?: RateLimitStatus;
  cost: number;
  responseTime: number;
  provider: string;
}
