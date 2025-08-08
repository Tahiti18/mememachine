import cron from 'node-cron';
import { EventEmitter } from 'events';
import { 
  SocialMediaMonitorConfig, 
  MonitorStatus, 
  Tweet, 
  ProcessedTweet, 
  MarketSignal,
  ProviderStatus 
} from '../types';
import { Logger } from '../utils/Logger';
import { CostManager } from '../utils/CostManager';

/**
 * Social Media Monitor - Main orchestrator for cost-effective tweet monitoring
 */
export class SocialMediaMonitor extends EventEmitter {
  private config: SocialMediaMonitorConfig;
  private cronJob: any;
  private isRunning = false;
  private status: MonitorStatus;

  constructor(config: SocialMediaMonitorConfig) {
    super();
    this.config = config;
    this.status = {
      isRunning: false,
      tweetsProcessedToday: 0,
      tokensCreatedToday: 0,
      errors: { count: 0 },
      performance: { averageProcessingTime: 0, successRate: 100 }
    };

    Logger.info('🤖 Social Media Monitor initialized', {
      accounts: config.monitoredAccounts.length,
      providers: config.providers.length,
      pollingInterval: config.pollingIntervalMinutes
    });
  }

  /**
   * Start monitoring with smart cost controls
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('Monitor already running');
      return;
    }

    try {
      const cronExpression = this.getCronExpression();
      Logger.info(`🚀 Starting monitoring with schedule: ${cronExpression}`);

      this.cronJob = cron.schedule(cronExpression, async () => {
        await this.performScan();
      }, {
        scheduled: false
      });

      this.cronJob.start();
      this.isRunning = true;
      this.status.isRunning = true;

      // Perform initial scan
      await this.performScan();

      Logger.info('✅ Social Media Monitor started successfully');
    } catch (error) {
      Logger.error('Failed to start monitor:', error);
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.destroy();
    }
    this.isRunning = false;
    this.status.isRunning = false;
    Logger.info('🛑 Social Media Monitor stopped');
  }

  /**
   * Perform a scan of all monitored accounts
   */
  async performScan(): Promise<void> {
    const scanStart = Date.now();
    Logger.debug('🔍 Starting scan cycle');

    try {
      // Check if throttling is enabled
      const isThrottled = await this.config.redisClient.get('throttling:enabled');
      if (isThrottled === 'true') {
        Logger.info('🐌 Scan throttled due to budget constraints');
        return;
      }

      // Get optimal provider based on cost and availability
      const provider = await this.config.costManager.selectOptimalProvider(this.config.providers);
      if (!provider) {
        Logger.error('No active providers available');
        return;
      }

      const newTweets: Tweet[] = [];

      // Monitor each account
      for (const account of this.config.monitoredAccounts) {
        try {
          Logger.debug(`Scanning @${account}`);
          const response = await provider.getUserTweets(account, 20);

          if (response.success) {
            // Track cost
            await this.config.costManager.trackRequest(provider.name, response.cost);

            // Filter for new tweets only
            const filtered = await this.filterNewTweets(response.data);
            newTweets.push(...filtered);

            Logger.debug(`Found ${filtered.length} new tweets from @${account}`);
          } else {
            Logger.warn(`Failed to fetch tweets from @${account}: ${response.error}`);
            this.status.errors.count++;
            this.status.errors.lastError = response.error;
            this.status.errors.lastErrorTime = new Date();
          }

        } catch (error) {
          Logger.error(`Error scanning @${account}:`, error);
          this.status.errors.count++;
        }
      }

      // Process new tweets
      if (newTweets.length > 0) {
        Logger.info(`📊 Processing ${newTweets.length} new tweets`);
        await this.processTweets(newTweets);
      }

      // Update status
      this.status.lastScanTime = new Date();
      this.status.nextScanTime = new Date(Date.now() + this.config.pollingIntervalMinutes * 60 * 1000);
      this.status.tweetsProcessedToday += newTweets.length;
      this.status.performance.averageProcessingTime = Date.now() - scanStart;

      Logger.debug(`✅ Scan completed in ${Date.now() - scanStart}ms`);

    } catch (error) {
      Logger.error('Error during scan:', error);
      this.status.errors.count++;
      this.status.errors.lastError = error instanceof Error ? error.message : String(error);
      this.status.errors.lastErrorTime = new Date();
    }
  }

  /**
   * Filter out tweets we've already processed
   */
  private async filterNewTweets(tweets: Tweet[]): Promise<Tweet[]> {
    const newTweets = [];

    for (const tweet of tweets) {
      const exists = await this.config.redisClient.exists(`tweet:${tweet.id}`);
      if (!exists) {
        // Mark as processed
        await this.config.redisClient.setEx(`tweet:${tweet.id}`, 7 * 24 * 60 * 60, 'processed'); // 7 days TTL
        newTweets.push(tweet);
      }
    }

    return newTweets;
  }

  /**
   * Process tweets and generate signals
   */
  private async processTweets(tweets: Tweet[]): Promise<void> {
    for (const tweet of tweets) {
      try {
        // Publish to sentiment analysis service
        await this.config.redisClient.publish('tweets:new', JSON.stringify({
          type: 'TWEET_DETECTED',
          data: tweet,
          timestamp: new Date(),
          source: 'social-monitor'
        }));

        Logger.debug(`📤 Published tweet ${tweet.id} for sentiment analysis`);
      } catch (error) {
        Logger.error(`Error processing tweet ${tweet.id}:`, error);
      }
    }
  }

  /**
   * Get recent tweets from cache
   */
  async getRecentTweets(limit: number = 20): Promise<Tweet[]> {
    // Implementation would fetch from Redis cache
    return [];
  }

  /**
   * Manual scan for testing
   */
  async performManualScan(): Promise<any> {
    Logger.info('🔧 Manual scan triggered');
    await this.performScan();
    return { message: 'Manual scan completed', timestamp: new Date() };
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig: Partial<MonitoringConfig>): Promise<void> {
    if (newConfig.monitoredAccounts) {
      this.config.monitoredAccounts = newConfig.monitoredAccounts;
    }
    if (newConfig.pollingIntervalMinutes) {
      this.config.pollingIntervalMinutes = newConfig.pollingIntervalMinutes;

      // Restart cron with new interval
      if (this.cronJob) {
        this.cronJob.destroy();
        const cronExpression = this.getCronExpression();
        this.cronJob = cron.schedule(cronExpression, async () => {
          await this.performScan();
        });
        this.cronJob.start();
      }
    }
    if (newConfig.sentimentThreshold !== undefined) {
      this.config.sentimentThreshold = newConfig.sentimentThreshold;
    }

    Logger.info('⚙️ Configuration updated', newConfig);
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<MonitorStatus> {
    return { ...this.status };
  }

  /**
   * Get provider status
   */
  async getProviderStatus(): Promise<ProviderStatus[]> {
    return this.config.providers.map(provider => ({
      name: provider.name,
      isActive: provider.isActive,
      costThisMonth: 0, // TODO: Get from cost manager
      requestsThisMonth: 0, // TODO: Get from cost manager
      rateLimit: {
        remaining: provider.rateLimit?.remaining || 0
      },
      health: provider.isActive ? 'healthy' : 'down',
      responseTime: 0 // TODO: Track response times
    }));
  }

  /**
   * Generate cron expression based on polling interval
   */
  private getCronExpression(): string {
    const minutes = this.config.pollingIntervalMinutes;

    if (minutes === 1) {
      return '* * * * *'; // Every minute
    } else if (minutes === 5) {
      return '*/5 * * * *'; // Every 5 minutes
    } else if (minutes === 15) {
      return '*/15 * * * *'; // Every 15 minutes
    } else if (minutes === 30) {
      return '*/30 * * * *'; // Every 30 minutes
    } else if (minutes === 60) {
      return '0 * * * *'; // Every hour
    } else {
      return `*/${minutes} * * * *`; // Custom interval
    }
  }
}