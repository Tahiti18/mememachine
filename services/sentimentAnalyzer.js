class SentimentAnalyzer {
  constructor(aiEnsemble) {
    this.aiEnsemble = aiEnsemble;
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
    this.analysisHistory = [];
    this.maxHistorySize = 1000;
  }

  // Main analyze method that index.js calls
  async analyze(text) {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('Invalid text input for sentiment analysis');
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(text);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log('Returning cached sentiment analysis');
        return cached;
      }

      // Perform analysis using AI ensemble
      const analysis = await this.aiEnsemble.analyze(text, 'sentiment');
      
      // Enhance with additional sentiment metrics
      const enhancedAnalysis = this.enhanceAnalysis(analysis, text);
      
      // Cache the result
      this.setCache(cacheKey, enhancedAnalysis);
      
      // Add to history
      this.addToHistory(text, enhancedAnalysis);
      
      return enhancedAnalysis;
    } catch (error) {
      console.error('Sentiment analysis failed:', error);
      return this.getFallbackAnalysis(text);
    }
  }

  // Method specifically for tweet analysis
  async analyzeTweet(tweetData) {
    try {
      const text = tweetData.content || tweetData.text || '';
      const author = tweetData.author || 'unknown';
      const metadata = tweetData.metadata || {};

      if (!text) {
        throw new Error('Tweet content is required');
      }

      console.log(`Analyzing tweet from @${author}: "${text.substring(0, 50)}..."`);

      // Get base sentiment analysis
      const baseAnalysis = await this.analyze(text);
      
      // Add Twitter-specific enhancements
      const tweetAnalysis = {
        ...baseAnalysis,
        author,
        tweetLength: text.length,
        hasHashtags: text.includes('#'),
        hasMentions: text.includes('@'),
        hasLinks: text.includes('http'),
        estimatedReach: this.estimateReach(author, text),
        viralPotential: this.calculateViralPotential(text, author),
        marketImpact: this.estimateMarketImpact(text, author, baseAnalysis.sentiment),
        timestamp: new Date().toISOString(),
        metadata
      };

      return tweetAnalysis;
    } catch (error) {
      console.error('Tweet analysis failed:', error);
      return this.getFallbackTweetAnalysis(tweetData);
    }
  }

  enhanceAnalysis(baseAnalysis, text) {
    try {
      return {
        ...baseAnalysis,
        textLength: text.length,
        wordCount: text.split(/\s+/).length,
        sentiment: this.normalizeSentiment(baseAnalysis.sentiment),
        viral: this.normalizeScore(baseAnalysis.viral),
        impact: this.normalizeScore(baseAnalysis.impact),
        confidence: this.normalizeScore(baseAnalysis.confidence),
        signal: this.determineSignal(baseAnalysis),
        keywords: this.extractKeywords(text),
        emotions: this.detectEmotions(text),
        urgency: this.detectUrgency(text),
        credibility: this.assessCredibility(text),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Analysis enhancement failed:', error);
      return baseAnalysis;
    }
  }

  normalizeSentiment(sentiment) {
    if (typeof sentiment !== 'number') return 50;
    return Math.max(0, Math.min(100, sentiment));
  }

  normalizeScore(score) {
    if (typeof score !== 'number') return 50;
    return Math.max(0, Math.min(100, score));
  }

  determineSignal(analysis) {
    const avgScore = (analysis.sentiment + analysis.viral + analysis.impact) / 3;
    if (avgScore >= 85) return 'HIGH';
    if (avgScore >= 70) return 'MEDIUM';
    if (avgScore >= 50) return 'LOW';
    return 'PROCESSING';
  }

  extractKeywords(text) {
    const keywords = [];
    const cryptoTerms = ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'defi', 'nft', 'token', 'coin', 'moon', 'hodl', 'diamond', 'hands'];
    const lowerText = text.toLowerCase();
    
    cryptoTerms.forEach(term => {
      if (lowerText.includes(term)) {
        keywords.push(term);
      }
    });
    
    return keywords;
  }

  detectEmotions(text) {
    const emotions = {
      excitement: 0,
      fear: 0,
      greed: 0,
      optimism: 0,
      skepticism: 0
    };

    const lowerText = text.toLowerCase();
    
    // Excitement indicators
    if (lowerText.includes('moon') || lowerText.includes('🚀') || lowerText.includes('incredible')) emotions.excitement += 30;
    if (text.includes('!')) emotions.excitement += 10;
    
    // Fear indicators  
    if (lowerText.includes('crash') || lowerText.includes('dump') || lowerText.includes('bear')) emotions.fear += 30;
    
    // Greed indicators
    if (lowerText.includes('buy') || lowerText.includes('profit') || lowerText.includes('gains')) emotions.greed += 20;
    
    // Optimism indicators
    if (lowerText.includes('future') || lowerText.includes('revolutionary') || lowerText.includes('potential')) emotions.optimism += 25;
    
    // Skepticism indicators
    if (lowerText.includes('doubt') || lowerText.includes('scam') || lowerText.includes('careful')) emotions.skepticism += 20;

    return emotions;
  }

  detectUrgency(text) {
    const urgencyWords = ['now', 'urgent', 'quickly', 'immediately', 'breaking', 'alert'];
    const lowerText = text.toLowerCase();
    let urgencyScore = 0;
    
    urgencyWords.forEach(word => {
      if (lowerText.includes(word)) urgencyScore += 15;
    });
    
    if (text.includes('!')) urgencyScore += 5;
    if (text.match(/[!]{2,}/)) urgencyScore += 10;
    
    return Math.min(100, urgencyScore);
  }

  assessCredibility(text) {
    let credibilityScore = 50; // Base score
    
    // Positive indicators
    if (text.length > 50 && text.length < 200) credibilityScore += 10; // Good length
    if (text.includes('data') || text.includes('research')) credibilityScore += 15;
    if (text.match(/\d+%/)) credibilityScore += 10; // Contains percentages
    
    // Negative indicators
    if (text.match(/[!]{3,}/)) credibilityScore -= 15; // Too many exclamations
    if (text.includes('guaranteed') || text.includes('100%')) credibilityScore -= 10;
    if (text.toLowerCase().includes('trust me')) credibilityScore -= 20;
    
    return Math.max(0, Math.min(100, credibilityScore));
  }

  estimateReach(author, text) {
    // Simplified reach estimation based on author and content
    const baseReach = 1000; // Base reach for unknown authors
    
    // Author influence multipliers
    const influencers = {
      'elonmusk': 100000,
      'vitalikbuterin': 50000,
      'michael_saylor': 30000,
      'cz_binance': 40000,
      'justinsuntron': 25000
    };
    
    const authorReach = influencers[author.toLowerCase()] || baseReach;
    
    // Content multipliers
    let multiplier = 1;
    if (text.includes('bitcoin') || text.includes('ethereum')) multiplier *= 1.5;
    if (text.includes('🚀') || text.includes('moon')) multiplier *= 1.3;
    if (text.length > 100 && text.length < 200) multiplier *= 1.2;
    
    return Math.floor(authorReach * multiplier);
  }

  calculateViralPotential(text, author) {
    let viralScore = 30; // Base score
    
    // Author influence
    const topInfluencers = ['elonmusk', 'vitalikbuterin', 'michael_saylor'];
    if (topInfluencers.includes(author.toLowerCase())) viralScore += 40;
    
    // Content factors
    if (text.includes('🚀')) viralScore += 15;
    if (text.includes('#')) viralScore += 10;
    if (text.includes('@')) viralScore += 5;
    if (text.match(/\b(moon|diamond|hands|hodl)\b/i)) viralScore += 20;
    
    // Length factor
    if (text.length >= 50 && text.length <= 200) viralScore += 10;
    
    return Math.min(100, viralScore);
  }

  estimateMarketImpact(text, author, sentiment) {
    let impactScore = 20; // Base score
    
    // Author weight
    const marketMovers = {
      'elonmusk': 50,
      'michael_saylor': 35,
      'vitalikbuterin': 30,
      'cz_binance': 25
    };
    
    impactScore += marketMovers[author.toLowerCase()] || 5;
    
    // Sentiment influence
    if (sentiment > 80) impactScore += 20;
    else if (sentiment < 30) impactScore += 15; // Negative news can also move markets
    
    // Content impact
    const marketTerms = ['bitcoin', 'btc', 'ethereum', 'crypto', 'investment', 'buy', 'sell'];
    marketTerms.forEach(term => {
      if (text.toLowerCase().includes(term)) impactScore += 8;
    });
    
    return Math.min(100, impactScore);
  }

  generateCacheKey(text) {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key); // Remove expired cache
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean old cache entries if cache gets too large
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  addToHistory(text, analysis) {
    this.analysisHistory.push({
      text: text.substring(0, 100), // Store only first 100 chars
      analysis,
      timestamp: Date.now()
    });
    
    // Keep history size manageable
    if (this.analysisHistory.length > this.maxHistorySize) {
      this.analysisHistory.shift();
    }
  }

  getFallbackAnalysis(text) {
    console.log('Using fallback sentiment analysis');
    return {
      sentiment: 50,
      viral: 30,
      impact: 40,
      confidence: 25,
      signal: 'PROCESSING',
      keywords: this.extractKeywords(text),
      emotions: this.detectEmotions(text),
      urgency: this.detectUrgency(text),
      credibility: this.assessCredibility(text),
      fallback: true,
      timestamp: new Date().toISOString()
    };
  }

  getFallbackTweetAnalysis(tweetData) {
    const text = tweetData.content || tweetData.text || '';
    const author = tweetData.author || 'unknown';
    
    return {
      ...this.getFallbackAnalysis(text),
      author,
      tweetLength: text.length,
      hasHashtags: text.includes('#'),
      hasMentions: text.includes('@'),
      hasLinks: text.includes('http'),
      estimatedReach: this.estimateReach(author, text),
      viralPotential: this.calculateViralPotential(text, author),
      marketImpact: this.estimateMarketImpact(text, author, 50),
      metadata: tweetData.metadata || {}
    };
  }

  getStats() {
    return {
      totalAnalyses: this.analysisHistory.length,
      cacheSize: this.cache.size,
      averageSentiment: this.analysisHistory.length > 0 
        ? this.analysisHistory.reduce((sum, item) => sum + item.analysis.sentiment, 0) / this.analysisHistory.length 
        : 0,
      recentAnalyses: this.analysisHistory.slice(-10)
    };
  }

  clearCache() {
    this.cache.clear();
    console.log('Sentiment analyzer cache cleared');
  }

  clearHistory() {
    this.analysisHistory = [];
    console.log('Analysis history cleared');
  }
}

module.exports = SentimentAnalyzer;
