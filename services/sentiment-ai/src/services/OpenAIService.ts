import OpenAI from 'openai';
import { Redis } from 'redis';
import {
  ProcessedTweet,
  SentimentAnalysis,
  TokenSuggestion,
  OpenAIAnalysisRequest,
  OpenAIAnalysisResponse,
  CostAnalytics
} from '../types';

export class OpenAIService {
  private openai: OpenAI;
  private redis: Redis;
  private costCache: Map<string, number> = new Map();
  private readonly MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  private readonly MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS || '1000');
  private readonly TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7');

  constructor(redis: Redis) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.redis = redis;
  }

  async analyzeTweet(request: OpenAIAnalysisRequest): Promise<OpenAIAnalysisResponse> {
    try {
      const prompt = this.buildAnalysisPrompt(request.tweet, request.context);

      const startTime = Date.now();
      const completion = await this.openai.chat.completions.create({
        model: this.MODEL,
        messages: [
          {
            role: 'system',
            content: \`You are a crypto market sentiment expert specializing in identifying viral meme coin opportunities from social media trends. Analyze tweets for market relevance, sentiment, and token creation potential.\`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.MAX_TOKENS,
        temperature: this.TEMPERATURE,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0].message.content;
      const tokensUsed = completion.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokensUsed);

      // Track costs
      await this.trackUsage(tokensUsed, cost, Date.now() - startTime);

      return this.parseOpenAIResponse(response!, request.tweet, tokensUsed, cost);
    } catch (error) {
      console.error('OpenAI analysis failed:', error);
      throw new Error(\`AI analysis failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
    }
  }

  private buildAnalysisPrompt(tweet: ProcessedTweet, context?: any): string {
    return \`Analyze this tweet for crypto market sentiment and meme coin potential:

Tweet: "\${tweet.content}"
Author: \${tweet.author} (\${tweet.metadata.followersCount} followers, verified: \${tweet.metadata.verifiedAccount})
Engagement: \${tweet.metrics.likes} likes, \${tweet.metrics.retweets} retweets
Posted: \${tweet.timestamp.toISOString()}

\${context?.marketConditions ? \`Market Context: \${context.marketConditions}\` : ''}
\${context?.recentTrends ? \`Recent Trends: \${context.recentTrends.join(', ')}\` : ''}

Provide a JSON response with this structure:
{
  "sentiment": {
    "type": "bullish|bearish|neutral",
    "confidence": 0.85,
    "marketRelevance": 0.92,
    "emotionalIntensity": 0.78,
    "keyPhrases": ["phrase1", "phrase2"],
    "marketSignals": {
      "mentionsTicker": true,
      "mentionsPump": false,
      "mentionsMoon": true,
      "mentionsAltcoin": false,
      "mentionsRocket": true
    },
    "aiReasoning": "Detailed analysis of why this sentiment was chosen"
  },
  "tokenSuggestion": {
    "name": "Suggested Token Name",
    "symbol": "SYMB",
    "description": "Brief description of the token concept",
    "theme": "meme|utility|community|viral",
    "marketCap": 50000,
    "confidence": 0.87,
    "reasoning": "Why this token would succeed based on the tweet"
  },
  "shouldCreateToken": true,
  "urgencyScore": 0.91
}

Focus on:
1. Is this tweet likely to drive significant market movement?
2. Does it suggest a viral meme coin opportunity?
3. What token concept would capitalize on this trend?
4. How urgent is the opportunity (time-sensitive nature)?

Only suggest token creation for high-confidence, viral-potential content.\`;
  }

  private parseOpenAIResponse(
    response: string,
    tweet: ProcessedTweet,
    tokensUsed: number,
    cost: number
  ): OpenAIAnalysisResponse {
    try {
      const parsed = JSON.parse(response);

      const sentimentAnalysis: SentimentAnalysis = {
        tweetId: tweet.id,
        sentiment: parsed.sentiment.type,
        confidence: parsed.sentiment.confidence,
        marketRelevance: parsed.sentiment.marketRelevance,
        emotionalIntensity: parsed.sentiment.emotionalIntensity,
        keyPhrases: parsed.sentiment.keyPhrases || [],
        marketSignals: parsed.sentiment.marketSignals || {},
        aiReasoning: parsed.sentiment.aiReasoning,
        processedAt: new Date()
      };

      const tokenSuggestion: TokenSuggestion | undefined = parsed.tokenSuggestion ? {
        name: parsed.tokenSuggestion.name,
        symbol: parsed.tokenSuggestion.symbol,
        description: parsed.tokenSuggestion.description,
        theme: parsed.tokenSuggestion.theme,
        marketCap: parsed.tokenSuggestion.marketCap,
        confidence: parsed.tokenSuggestion.confidence,
        reasoning: parsed.tokenSuggestion.reasoning,
        basedOnTweet: tweet.id,
        suggestedAt: new Date()
      } : undefined;

      return {
        sentiment: sentimentAnalysis,
        tokenSuggestion,
        shouldCreateToken: parsed.shouldCreateToken || false,
        urgencyScore: parsed.urgencyScore || 0
      };
    } catch (error) {
      throw new Error(\`Failed to parse OpenAI response: \${error}\`);
    }
  }

  private calculateCost(tokens: number): number {
    // GPT-3.5-turbo pricing: $0.001 per 1K tokens for input, $0.002 per 1K tokens for output
    // Simplified: assuming 50/50 split
    const inputTokens = Math.floor(tokens * 0.5);
    const outputTokens = Math.ceil(tokens * 0.5);

    return (inputTokens / 1000) * 0.001 + (outputTokens / 1000) * 0.002;
  }

  private async trackUsage(tokens: number, cost: number, responseTime: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const usageKey = \`ai_usage:\${today}\`;

    try {
      await this.redis.multi()
        .hIncrBy(usageKey, 'total_tokens', tokens)
        .hIncrByFloat(usageKey, 'total_cost', cost)
        .hIncrBy(usageKey, 'request_count', 1)
        .hIncrBy(usageKey, 'total_response_time', responseTime)
        .expire(usageKey, 604800) // 7 days
        .exec();
    } catch (error) {
      console.error('Failed to track AI usage:', error);
    }
  }

  async getCostAnalytics(): Promise<CostAnalytics> {
    const today = new Date().toISOString().split('T')[0];
    const usageKey = \`ai_usage:\${today}\`;

    try {
      const usage = await this.redis.hGetAll(usageKey);
      const totalTokens = parseInt(usage.total_tokens || '0');
      const totalCost = parseFloat(usage.total_cost || '0');
      const requestCount = parseInt(usage.request_count || '0');

      const dailyBudget = parseFloat(process.env.DAILY_AI_BUDGET || '10');

      return {
        totalTokensUsed: totalTokens,
        totalCost,
        requestCount,
        averageCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
        budgetUsage: (totalCost / dailyBudget) * 100,
        estimatedDailyCost: totalCost,
        lastReset: new Date(today + 'T00:00:00Z')
      };
    } catch (error) {
      console.error('Failed to get cost analytics:', error);
      return {
        totalTokensUsed: 0,
        totalCost: 0,
        requestCount: 0,
        averageCostPerRequest: 0,
        budgetUsage: 0,
        estimatedDailyCost: 0,
        lastReset: new Date()
      };
    }
  }

  async batchAnalyzeTweets(tweets: ProcessedTweet[]): Promise<OpenAIAnalysisResponse[]> {
    const results: OpenAIAnalysisResponse[] = [];

    // Process in batches to manage costs and rate limits
    const batchSize = parseInt(process.env.AI_BATCH_SIZE || '3');

    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);

      const batchPromises = batch.map(tweet => 
        this.analyzeTweet({ tweet }).catch(error => {
          console.error(\`Failed to analyze tweet \${tweet.id}:\`, error);
          return null;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null) as OpenAIAnalysisResponse[]);

      // Rate limiting delay between batches
      if (i + batchSize < tweets.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  async checkBudgetStatus(): Promise<{ canProcess: boolean; budgetUsage: number }> {
    const analytics = await this.getCostAnalytics();
    const maxBudgetUsage = parseFloat(process.env.MAX_AI_BUDGET_USAGE || '85');

    return {
      canProcess: analytics.budgetUsage < maxBudgetUsage,
      budgetUsage: analytics.budgetUsage
    };
  }
}
