import axios, { AxiosInstance } from 'axios';
import { Tweet, RapidAPIProviderConfig, APIResponse } from '../types';
import { Logger } from '../utils/Logger';

/**
 * RapidAPI Provider - Fallback Twitter data source
 * Cost: Higher than TwitterAPI.io but more reliable than official API
 */
export class RapidAPIProvider {
  private config: RapidAPIProviderConfig;
  private client: AxiosInstance;

  constructor(config: RapidAPIProviderConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: `https://${config.host}`,
      headers: {
        'X-RapidAPI-Key': config.apiKey,
        'X-RapidAPI-Host': config.host,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    Logger.info('⚡ RapidAPI provider initialized', {
      host: config.host,
      costPerRequest: config.costPerRequest
    });
  }

  async getUserTweets(username: string, count: number = 20): Promise<APIResponse<Tweet[]>> {
    const startTime = Date.now();

    try {
      const response = await this.client.get('/v2/user/tweets', {
        params: {
          username,
          count: Math.min(count, 50)
        }
      });

      const tweets = this.transformTweets(response.data.data || []);

      Logger.logCost('rapidapi', this.config.costPerRequest, `getUserTweets:${username}`);

      return {
        data: tweets,
        success: true,
        cost: this.config.costPerRequest,
        responseTime: Date.now() - startTime,
        provider: 'rapidapi'
      };

    } catch (error: any) {
      Logger.error(`RapidAPI error for @${username}:`, error.response?.data || error.message);

      return {
        data: [],
        success: false,
        error: error.response?.data?.message || error.message,
        cost: 0,
        responseTime: Date.now() - startTime,
        provider: 'rapidapi'
      };
    }
  }

  private transformTweets(apiTweets: any[]): Tweet[] {
    return apiTweets.map(tweet => ({
      id: tweet.id_str || tweet.id,
      text: tweet.full_text || tweet.text,
      author: tweet.user?.screen_name || 'unknown',
      authorId: tweet.user?.id_str || 'unknown',
      createdAt: new Date(tweet.created_at),
      metrics: {
        likes: tweet.favorite_count || 0,
        retweets: tweet.retweet_count || 0,
        replies: tweet.reply_count || 0,
      },
      isRetweet: tweet.retweeted_status !== undefined,
      originalTweetId: tweet.retweeted_status?.id_str,
      language: tweet.lang
    }));
  }

  get isActive(): boolean {
    return true; // RapidAPI typically has higher limits
  }

  get costPerRequest(): number {
    return this.config.costPerRequest;
  }

  get name(): string {
    return 'rapidapi';
  }
}