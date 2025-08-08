import axios, { AxiosInstance } from 'axios';
import { Tweet, TwitterAPIProviderConfig, APIResponse, RateLimitStatus } from '../types';
import { Logger } from '../utils/Logger';

/**
 * TwitterAPI.io Provider - Most cost-effective Twitter data source
 * Cost: $0.15 per 1K requests vs Twitter's $200/month minimum
 */
export class TwitterAPIProvider {
  private config: TwitterAPIProviderConfig;
  private client: AxiosInstance;
  private rateLimit: RateLimitStatus;

  constructor(config: TwitterAPIProviderConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.host,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    this.rateLimit = {
      remaining: config.rateLimit,
      limit: config.rateLimit,
      resetTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour window
      windowStart: new Date()
    };

    Logger.info('🐦 TwitterAPI.io provider initialized', {
      host: config.host,
      rateLimit: config.rateLimit,
      costPerRequest: config.costPerRequest
    });
  }

  /**
   * Get recent tweets from a user
   */
  async getUserTweets(username: string, count: number = 20): Promise<APIResponse<Tweet[]>> {
    const startTime = Date.now();

    try {
      Logger.debug(`Fetching ${count} tweets for @${username}`);

      const response = await this.client.get(`/v2/users/by/username/${username}/tweets`, {
        params: {
          max_results: Math.min(count, 100), // API limit
          'tweet.fields': 'created_at,public_metrics,entities,lang,referenced_tweets',
          'user.fields': 'public_metrics,verified'
        }
      });

      const tweets = this.transformTweets(response.data.data || []);
      const responseTime = Date.now() - startTime;

      // Update rate limiting
      this.updateRateLimit();

      Logger.logCost('twitterapi.io', this.config.costPerRequest, `getUserTweets:${username}`);

      return {
        data: tweets,
        success: true,
        rateLimitStatus: this.rateLimit,
        cost: this.config.costPerRequest,
        responseTime,
        provider: 'twitterapi.io'
      };

    } catch (error: any) {
      Logger.error(`TwitterAPI.io error for @${username}:`, error.response?.data || error.message);

      return {
        data: [],
        success: false,
        error: error.response?.data?.detail || error.message,
        cost: 0, // Don't charge for failed requests
        responseTime: Date.now() - startTime,
        provider: 'twitterapi.io'
      };
    }
  }

  /**
   * Search tweets by keywords
   */
  async searchTweets(query: string, count: number = 20): Promise<APIResponse<Tweet[]>> {
    const startTime = Date.now();

    try {
      const response = await this.client.get('/v2/tweets/search/recent', {
        params: {
          query,
          max_results: Math.min(count, 100),
          'tweet.fields': 'created_at,public_metrics,entities,lang',
          'user.fields': 'public_metrics,verified'
        }
      });

      const tweets = this.transformTweets(response.data.data || []);
      const responseTime = Date.now() - startTime;

      this.updateRateLimit();
      Logger.logCost('twitterapi.io', this.config.costPerRequest, `searchTweets:${query}`);

      return {
        data: tweets,
        success: true,
        rateLimitStatus: this.rateLimit,
        cost: this.config.costPerRequest,
        responseTime,
        provider: 'twitterapi.io'
      };

    } catch (error: any) {
      Logger.error('TwitterAPI.io search error:', error.response?.data || error.message);

      return {
        data: [],
        success: false,
        error: error.response?.data?.detail || error.message,
        cost: 0,
        responseTime: Date.now() - startTime,
        provider: 'twitterapi.io'
      };
    }
  }

  /**
   * Transform API response to our Tweet interface
   */
  private transformTweets(apiTweets: any[]): Tweet[] {
    return apiTweets.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      author: tweet.author?.username || 'unknown',
      authorId: tweet.author_id,
      createdAt: new Date(tweet.created_at),
      metrics: {
        likes: tweet.public_metrics?.like_count || 0,
        retweets: tweet.public_metrics?.retweet_count || 0,
        replies: tweet.public_metrics?.reply_count || 0,
        views: tweet.public_metrics?.impression_count || 0
      },
      entities: {
        hashtags: tweet.entities?.hashtags?.map((h: any) => h.tag) || [],
        mentions: tweet.entities?.mentions?.map((m: any) => m.username) || [],
        urls: tweet.entities?.urls?.map((u: any) => u.expanded_url) || []
      },
      isRetweet: tweet.referenced_tweets?.some((ref: any) => ref.type === 'retweeted') || false,
      originalTweetId: tweet.referenced_tweets?.find((ref: any) => ref.type === 'retweeted')?.id,
      language: tweet.lang
    }));
  }

  private updateRateLimit(): void {
    this.rateLimit.remaining = Math.max(0, this.rateLimit.remaining - 1);

    // Reset rate limit if window expired
    if (Date.now() > this.rateLimit.resetTime.getTime()) {
      this.rateLimit.remaining = this.config.rateLimit;
      this.rateLimit.resetTime = new Date(Date.now() + 60 * 60 * 1000);
      this.rateLimit.windowStart = new Date();
    }
  }

  get isActive(): boolean {
    return this.rateLimit.remaining > 0;
  }

  get costPerRequest(): number {
    return this.config.costPerRequest;
  }

  get name(): string {
    return 'twitterapi.io';
  }
}