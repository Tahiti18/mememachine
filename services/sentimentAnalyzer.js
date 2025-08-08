class SentimentAnalyzer {
  constructor(aiEnsemble) {
    this.aiEnsemble = aiEnsemble;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async analyzeTweet(tweetData) {
    const { content, author, metadata = {} } = tweetData;

    // Check cache first
    const cacheKey = this.generateCacheKey(content, author);
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      console.log('📋 Using cached analysis');
      return cached.analysis;
    }

    try {
      // Create analysis prompt
      const prompt = this.createAnalysisPrompt(content, author, metadata);
      const context = { author, content, metadata };

      console.log(`🔍 Analyzing tweet from @${author}: "${content.substring(0, 50)}..."`);

      // Use AI ensemble for analysis
      const rawAnalysis = await this.aiEnsemble.analyzeWithEnsemble(prompt, context);

      // Post-process and enhance the analysis
      const enhancedAnalysis = this.enhanceAnalysis(rawAnalysis, tweetData);

      // Cache the result
      this.cache.set(cacheKey, {
        analysis: enhancedAnalysis,
        timestamp: Date.now()
      });

      // Clean old cache entries
      this.cleanCache();

      return enhancedAnalysis;

    } catch (error) {
      console.error('Sentiment analysis error:', error);

      // Return fallback analysis
      return this.getFallbackAnalysis(tweetData);
    }
  }

  createAnalysisPrompt(content, author, metadata) {
    return `Analyze this tweet for cryptocurrency sentiment and market impact:

TWEET: "${content}"
AUTHOR: @${author}
CONTEXT: ${this.getAuthorContext(author)}

Please provide a JSON response with these exact fields:
{
  "sentiment": <number 1-100, where 100 is extremely bullish>,
  "viral": <number 1-100, likelihood of going viral>,
  "impact": <number 1-100, potential market impact>,
  "confidence": <number 0.0-1.0, your confidence in this analysis>,
  "keywords": ["key", "crypto", "terms", "found"],
  "category": "<one of: price_prediction, tech_announcement, general_crypto, non_crypto>",
  "urgency": "<one of: low, medium, high, critical>",
  "reasoning": "Brief explanation of your analysis"
}

Consider:
- Author's influence in crypto space
- Tweet content and language sentiment
- Timing and market context
- Potential for creating FOMO or FUD
- Historical impact of similar tweets`;
  }

  getAuthorContext(author) {
    const contexts = {
      elonmusk: "Tesla CEO, major crypto influencer, moves markets with tweets",
      VitalikButerin: "Ethereum founder, technical authority, highly respected",
      michael_saylor: "MicroStrategy CEO, Bitcoin advocate, institutional voice",
      cathiedwood: "ARK Invest CEO, innovation investor",
      satoshi_nakamoto: "Bitcoin creator (likely inactive)",
      justinsuntron: "Tron founder, controversial figure",
      cz_binance: "Former Binance CEO, major exchange influence"
    };

    return contexts[author] || "Crypto community member";
  }

  enhanceAnalysis(rawAnalysis, tweetData) {
    const enhanced = {
      ...rawAnalysis,
      timestamp: new Date().toISOString(),
      tweetData: {
        content: tweetData.content,
        author: tweetData.author,
        length: tweetData.content.length
      }
    };

    // Add signal strength
    enhanced.signal = this.calculateSignalStrength(enhanced);

    // Add market timing context
    enhanced.marketContext = this.getMarketContext();

    // Add author influence multiplier
    enhanced.authorInfluence = this.getAuthorInfluence(tweetData.author);

    // Adjust scores based on context
    enhanced.adjustedScores = this.adjustScoresForContext(enhanced);

    return enhanced;
  }

  calculateSignalStrength(analysis) {
    const sentiment = analysis.sentiment || 50;
    const viral = analysis.viral || 30;
    const impact = analysis.impact || 40;
    const confidence = analysis.confidence || 0.5;

    const score = (sentiment + viral + impact) / 3 * confidence;

    if (score >= 80) return 'HIGH';
    if (score >= 60) return 'MEDIUM';
    if (score >= 40) return 'LOW';
    return 'FILTERED';
  }

  getMarketContext() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    return {
      isMarketHours: day >= 1 && day <= 5 && hour >= 9 && hour <= 16,
      timeZone: 'EST',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
      hour: hour
    };
  }

  getAuthorInfluence(author) {
    const influences = {
      elonmusk: 1.5,          // 50% boost
      VitalikButerin: 1.3,    // 30% boost  
      michael_saylor: 1.2,    // 20% boost
      cathiedwood: 1.1,       // 10% boost
    };

    return influences[author] || 1.0;
  }

  adjustScoresForContext(analysis) {
    const base = {
      sentiment: analysis.sentiment || 50,
      viral: analysis.viral || 30,
      impact: analysis.impact || 40
    };

    const influence = analysis.authorInfluence || 1.0;
    const isMarketHours = analysis.marketContext?.isMarketHours || false;

    return {
      sentiment: Math.min(100, base.sentiment * influence),
      viral: Math.min(100, base.viral * influence * (isMarketHours ? 1.1 : 1.0)),
      impact: Math.min(100, base.impact * influence * (isMarketHours ? 1.2 : 1.0))
    };
  }

  getFallbackAnalysis(tweetData) {
    console.log('🔄 Using fallback sentiment analysis');

    const content = tweetData.content.toLowerCase();

    // Simple keyword-based analysis
    const bullishWords = ['bullish', 'moon', 'rocket', 'up', 'gain', 'profit', 'buy', 'hodl'];
    const bearishWords = ['bearish', 'crash', 'down', 'loss', 'sell', 'dump', 'fear'];
    const cryptoWords = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'defi'];

    const bullishCount = bullishWords.filter(word => content.includes(word)).length;
    const bearishCount = bearishWords.filter(word => content.includes(word)).length;
    const cryptoCount = cryptoWords.filter(word => content.includes(word)).length;

    const sentiment = Math.max(10, Math.min(90, 50 + (bullishCount - bearishCount) * 10));
    const viral = Math.max(10, Math.min(90, 20 + cryptoCount * 10));
    const impact = Math.max(10, Math.min(90, (sentiment + viral) / 2));

    return {
      sentiment,
      viral,
      impact,
      confidence: 0.4,
      signal: impact >= 60 ? 'MEDIUM' : 'LOW',
      fallback: true,
      timestamp: new Date().toISOString()
    };
  }

  generateCacheKey(content, author) {
    // Simple hash function for cache key
    return `${author}_${content.substring(0, 50)}_${content.length}`;
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      timeout: this.cacheTimeout,
      oldestEntry: Math.min(...Array.from(this.cache.values()).map(v => v.timestamp))
    };
  }
}

module.exports = SentimentAnalyzer;
