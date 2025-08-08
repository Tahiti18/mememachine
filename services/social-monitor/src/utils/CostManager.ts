import { CostManagerConfig, CostAnalytics, LogLevel } from '../types';
import { Logger } from './Logger';

/**
 * Cost Manager - Smart budget tracking and optimization
 * This is the core component that keeps costs under control
 */
export class CostManager {
  private config: CostManagerConfig;
  private currentMonthKey: string;

  constructor(config: CostManagerConfig) {
    this.config = config;
    this.currentMonthKey = this.getMonthKey();
    Logger.info('💰 Cost Manager initialized', {
      monthlyBudget: config.monthlyBudget,
      autoThrottleAt: config.autoThrottleAt,
      emergencyStopAt: config.emergencyStopAt
    });
  }

  /**
   * Track API request cost
   */
  async trackRequest(provider: string, cost: number): Promise<boolean> {
    try {
      const key = `costs:${this.currentMonthKey}`;
      const providerKey = `${key}:${provider}`;

      // Update total cost and provider-specific cost
      await this.config.redisClient.hIncrByFloat(key, 'totalCost', cost);
      await this.config.redisClient.hIncrBy(key, 'totalRequests', 1);
      await this.config.redisClient.hIncrByFloat(providerKey, 'cost', cost);
      await this.config.redisClient.hIncrBy(providerKey, 'requests', 1);

      // Check if we're approaching limits
      const currentUsage = await this.getCurrentUsage();

      if (currentUsage.budgetUsedPercent >= this.config.emergencyStopAt) {
        Logger.error('🚨 EMERGENCY STOP: Budget limit exceeded!', currentUsage);
        return false;
      }

      if (currentUsage.budgetUsedPercent >= this.config.autoThrottleAt) {
        Logger.warn('⚠️  Auto-throttling activated', currentUsage);
        // Implement throttling logic
        await this.enableThrottling();
      }

      return true;
    } catch (error) {
      Logger.error('Error tracking request cost:', error);
      return false;
    }
  }

  /**
   * Get current budget usage
   */
  async getCurrentUsage(): Promise<CostAnalytics['currentMonth']> {
    try {
      const key = `costs:${this.currentMonthKey}`;
      const data = await this.config.redisClient.hGetAll(key);

      const totalCost = parseFloat(data.totalCost || '0');
      const totalRequests = parseInt(data.totalRequests || '0');

      return {
        totalCost,
        requestsCount: totalRequests,
        averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
        budgetUsedPercent: (totalCost / this.config.monthlyBudget) * 100,
        remainingBudget: this.config.monthlyBudget - totalCost
      };
    } catch (error) {
      Logger.error('Error getting current usage:', error);
      return {
        totalCost: 0,
        requestsCount: 0,
        averageCostPerRequest: 0,
        budgetUsedPercent: 0,
        remainingBudget: this.config.monthlyBudget
      };
    }
  }

  /**
   * Get comprehensive analytics
   */
  async getAnalytics(): Promise<CostAnalytics> {
    const currentMonth = await this.getCurrentUsage();

    // Calculate projected usage based on current trend
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const currentDay = new Date().getDate();
    const projectionMultiplier = daysInMonth / currentDay;

    return {
      currentMonth,
      providers: {}, // TODO: Implement provider breakdown
      dailyBreakdown: [], // TODO: Implement daily breakdown
      projectedMonthlyUsage: {
        estimatedTotalCost: currentMonth.totalCost * projectionMultiplier,
        estimatedRequests: currentMonth.requestsCount * projectionMultiplier,
        willExceedBudget: (currentMonth.totalCost * projectionMultiplier) > this.config.monthlyBudget
      }
    };
  }

  /**
   * Smart provider selection based on cost and availability
   */
  async selectOptimalProvider(providers: any[]): Promise<any> {
    const currentUsage = await this.getCurrentUsage();

    // If we're approaching budget limits, prefer cheaper providers
    if (currentUsage.budgetUsedPercent > 70) {
      providers.sort((a, b) => a.costPerRequest - b.costPerRequest);
    }

    // Return first active provider
    return providers.find(provider => provider.isActive);
  }

  private getMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private async enableThrottling(): Promise<void> {
    // Increase polling intervals when throttling
    await this.config.redisClient.set('throttling:enabled', 'true');
    await this.config.redisClient.set('throttling:multiplier', '2');
    Logger.info('🐌 Throttling enabled to conserve budget');
  }
}