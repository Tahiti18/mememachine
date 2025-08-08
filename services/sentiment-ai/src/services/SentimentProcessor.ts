import { Redis } from 'redis';
import { OpenAIService } from './OpenAIService';
import {
  ProcessedTweet,
  SentimentAnalysis,
  OpenAIAnalysisResponse,
  ServiceStatus,
  AIConfiguration
} from '../types';

export class SentimentProcessor {
  private redis: Redis;
  private openaiService: OpenAIService;
  private isProcessing = false;
  private processedCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  constructor(redis: Redis) {
    this.redis = redis;
    this.openaiService = new OpenAIService(redis);
  }

  async startProcessing(): Promise<void> {
    console.log('🎯 Starting sentiment processor...');

    // Subscribe to new tweets from social-monitor
    await this.redis.subscribe('new_tweets', (message) => {
      this.processTweetMessage(message);
    });

    // Process any backlog
    await this.processBacklog();

    this.isProcessing = true;
    console.log('✅ Sentiment processor active and listening for tweets');
  }

  private async processTweetMessage(message: string): Promise<void> {
    try {
      const tweet: ProcessedTweet = JSON.parse(message);
      await this.processSingleTweet(tweet);
    } catch (error) {
      console.error('Failed to process tweet message:', error);
      this.errorCount++;
    }
  }

  private async processSingleTweet(tweet: ProcessedTweet): Promise<void> {
    try {
      // Check if already processed
      const processedKey = `processed_sentiment:${tweet.id}`;
      const isProcessed = await this.redis.exists(processedKey);

      if (isProcessed) {
        console.log(`Tweet ${tweet.id} already processed, skipping`);
        return;
      }

      // Check budget before processing
      const budgetStatus = await this.openaiService.checkBudgetStatus();
      if (!budgetStatus.canProcess) {
        console.warn(`Budget limit reached (${budgetStatus.budgetUsage.toFixed(1)}%), skipping AI analysis`);
        return;
      }

      console.log(`🔍 Analyzing tweet: ${tweet.id} from @${tweet.author}`);

      const analysis = await this.openaiService.analyzeTweet({
        tweet,
        context: await this.getContextForTweet(tweet)
      });

      // Save analysis results
      await this.saveAnalysisResults(tweet, analysis);

      // Mark as processed
      await this.redis.setEx(processedKey, 3600 * 24, 'processed'); // 24 hours

      // Publish results to downstream services
      await this.publishAnalysisResults(analysis);

      this.processedCount++;
      console.log(`✅ Tweet ${tweet.id} analyzed - Sentiment: ${analysis.sentiment.sentiment} (${(analysis.sentiment.confidence * 100).toFixed(1)}% confidence)`);

    } catch (error) {
      console.error(`Failed to process tweet ${tweet.id}:`, error);
      this.errorCount++;

      // Save error info for debugging
      await this.redis.setEx(
        `error_sentiment:${tweet.id}`,
        3600,
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          tweet: tweet.id
        })
      );
    }
  }

  private async getContextForTweet(tweet: ProcessedTweet): Promise<any> {
    try {
      // Get recent trends and market context
      const [recentTrends, marketConditions] = await Promise.all([
        this.redis.lRange('trending_phrases', 0, 9),
        this.redis.get('market_conditions')
      ]);

      return {
        recentTrends,
        marketConditions: marketConditions ? JSON.parse(marketConditions) : null
      };
    } catch (error) {
      console.error('Failed to get context:', error);
      return {};
    }
  }

  private async saveAnalysisResults(tweet: ProcessedTweet, analysis: OpenAIAnalysisResponse): Promise<void> {
    const analysisKey = `sentiment_analysis:${tweet.id}`;

    const analysisData = {
      ...analysis.sentiment,
      tokenSuggestion: analysis.tokenSuggestion,
      shouldCreateToken: analysis.shouldCreateToken,
      urgencyScore: analysis.urgencyScore,
      originalTweet: {
        id: tweet.id,
        author: tweet.author,
        content: tweet.content,
        timestamp: tweet.timestamp
      }
    };

    // Save analysis with 7-day expiration
    await this.redis.setEx(
      analysisKey,
      3600 * 24 * 7,
      JSON.stringify(analysisData)
    );

    // Add to sentiment index for querying
    if (analysis.sentiment.marketRelevance > 0.7) {
      await this.redis.zAdd(
        'high_relevance_sentiment',
        {
          score: analysis.sentiment.marketRelevance * analysis.sentiment.confidence,
          value: tweet.id
        }
      );
    }

    // Store by sentiment type
    const sentimentList = `sentiment_${analysis.sentiment.sentiment}`;
    await this.redis.lPush(sentimentList, tweet.id);
    await this.redis.lTrim(sentimentList, 0, 99); // Keep last 100
  }

  private async publishAnalysisResults(analysis: OpenAIAnalysisResponse): Promise<void> {
    try {
      // Publish to token creator if token creation is suggested
      if (analysis.shouldCreateToken && analysis.tokenSuggestion) {
        await this.redis.publish('token_suggestions', JSON.stringify({
          suggestion: analysis.tokenSuggestion,
          sentiment: analysis.sentiment,
          urgencyScore: analysis.urgencyScore,
          timestamp: new Date().toISOString()
        }));
      }

      // Publish to trading agent for market signals
      if (analysis.sentiment.marketRelevance > 0.8) {
        await this.redis.publish('market_signals', JSON.stringify({
          signal: {
            type: analysis.sentiment.sentiment,
            strength: analysis.sentiment.confidence * analysis.sentiment.marketRelevance,
            keyPhrases: analysis.sentiment.keyPhrases,
            tweetId: analysis.sentiment.tweetId
          },
          timestamp: new Date().toISOString()
        }));
      }

      console.log(`📤 Published analysis results for tweet ${analysis.sentiment.tweetId}`);
    } catch (error) {
      console.error('Failed to publish analysis results:', error);
    }
  }

  async processBacklog(): Promise<void> {
    try {
      const backlogTweets = await this.redis.lRange('tweet_backlog', 0, -1);

      if (backlogTweets.length === 0) {
        console.log('📭 No backlog tweets to process');
        return;
      }

      console.log(`📬 Processing ${backlogTweets.length} backlog tweets`);

      const tweets: ProcessedTweet[] = backlogTweets
        .map(tweetStr => {
          try {
            return JSON.parse(tweetStr);
          } catch {
            return null;
          }
        })
        .filter(tweet => tweet !== null);

      // Process in batches
      const batchResults = await this.openaiService.batchAnalyzeTweets(tweets);

      for (let i = 0; i < batchResults.length; i++) {
        const analysis = batchResults[i];
        const tweet = tweets[i];

        if (analysis && tweet) {
          await this.saveAnalysisResults(tweet, analysis);
          await this.publishAnalysisResults(analysis);
        }
      }

      // Clear processed backlog
      await this.redis.del('tweet_backlog');

      console.log(`✅ Processed ${batchResults.length} backlog tweets`);
    } catch (error) {
      console.error('Failed to process backlog:', error);
    }
  }

  async getServiceStatus(): Promise<ServiceStatus> {
    const costAnalytics = await this.openaiService.getCostAnalytics();
    const redisConnected = this.redis.isOpen;

    return {
      isActive: this.isProcessing,
      redisConnected,
      openaiConnected: true, // Would need actual test
      processingQueue: await this.getQueueSize(),
      costAnalytics,
      lastProcessedTweet: this.processedCount > 0 ? new Date() : undefined,
      errorCount: this.errorCount,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  private async getQueueSize(): Promise<number> {
    try {
      return await this.redis.lLen('tweet_backlog');
    } catch {
      return 0;
    }
  }

  async stop(): Promise<void> {
    this.isProcessing = false;
    console.log('🛑 Sentiment processor stopped');
  }
}
