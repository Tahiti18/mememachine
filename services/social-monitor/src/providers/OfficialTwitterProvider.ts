import axios, { AxiosInstance } from 'axios';
import { Tweet, OfficialTwitterProviderConfig, APIResponse } from '../types';
import { Logger } from '../utils/Logger';

/**
 * Official Twitter API Provider - For enterprise scaling
 * Cost: $200/month basic, $5000/month pro
 */
export class OfficialTwitterProvider {
  private config: OfficialTwitterProviderConfig;
  private client: AxiosInstance;

  constructor(config: OfficialTwitterProviderConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://api.twitter.com/2',
      headers: {
        'Authorization': `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    Logger.info('🏛️ Official Twitter API provider initialized');
  }

  async getUserTweets(username: string, count: number = 20): Promise<APIResponse<Tweet[]>> {
    const startTime = Date.now();

    try {
      // First get user ID
      const userResponse = await this.client.get('/users/by/username/' + username);
      const userId = userResponse.data.data.id;

      // Then get tweets
      const response = await this.client.get(`/users/${userId}/tweets`, {
        params: {
          max_results: Math.min(count, 100),
          'tweet.fields': 'created_at,public_metrics,entities,lang,referenced_tweets',
          'user.fields': 'public_metrics,verified'
        }
      });

      const tweets = this.transformTweets(response.data.data || []);

      Logger.logCost('twitter-official', this.config.costPerRequest, `getUserTweets:${username}`);

      return {
        data: tweets,
        success: true,
        cost: this.config.costPerRequest,
        responseTime: Date.now() - startTime,
        provider: 'twitter-official'
      };

    } catch (error: any) {
      Logger.error(`Official Twitter API error for @${username}:`, error.response?.data || error.message);

      return {
        data: [],
        success: false,
        error: error.response?.data?.detail || error.message,
        cost: 0,
        responseTime: Date.now() - startTime,
        provider: 'twitter-official'
      };
    }
  }

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
      isRetweet: tweet.referenced_tweets?.some((ref: any) => ref.type === 'retweeted') || false,
      originalTweetId: tweet.referenced_tweets?.find((ref: any) => ref.type === 'retweeted')?.id,
      language: tweet.lang
    }));
  }

  get isActive(): boolean {
    return true;
  }

  get costPerRequest(): number {
    return this.config.costPerRequest;
  }

  get name(): string {
    return 'twitter-official';
  }
}