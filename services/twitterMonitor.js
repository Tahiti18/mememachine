const axios = require('axios');

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;

    this.monitoringAccounts = [];
    this.isMonitoring = false;
    this.isFetching = false;
    this.tweets = [];
    this.maxTweets = 100;

    this.pollInterval = 60_000; // 1 minute
    this.intervalId = null;
    this.lastFetchTime = null;

    this.rateLimitRemaining = 100;
    this.rateLimitReset = null;

    this.lastSeenIdByUser = {};

    // ✅ AUTO-START on deploy
    if (this.apiKey) {
      console.log('🚀 Auto-starting Twitter monitoring...');
      this.start(['elonmusk', 'VitalikButerin', 'michael_saylor'])
        .then(() => console.log('✅ Twitter monitoring started automatically'))
        .catch(err => console.error('❌ Failed to auto-start monitoring:', err.message));
    } else {
      console.warn('⚠️ No TwitterAPI.io key found — monitoring not started.');
    }
  }

  async start(accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor']) {
    if (this.isMonitoring) {
      return { success: true, message: 'Already monitoring' };
    }
    if (!this.apiKey) {
      throw new Error('TwitterAPI.io API key not configured');
    }

    this.monitoringAccounts = accounts;
    this.isMonitoring = true;

    await this.fetchLatestTweets();

    this.intervalId = setInterval(async () => {
      try {
        if (!this.isFetching) {
          await this.fetchLatestTweets();
        }
      } catch {
        // errors already logged
      }
    }, this.pollInterval);

    return {
      success: true,
      message: 'Monitoring started',
      accounts: this.monitoringAccounts,
      pollInterval: this.pollInterval
    };
  }

  async stop() {
    if (!this.isMonitoring) {
      return { success: true, message: 'Already stopped' };
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isMonitoring = false;
    return { success: true, message: 'Monitoring stopped' };
  }

  async fetchLatestTweets() {
    if (!this.apiKey) throw new Error('TwitterAPI.io API key not configured');

    if (this.isFetching) return [];
    this.isFetching = true;

    try {
      const newTweets = [];

      for (const account of this.monitoringAccounts) {
        try {
          const userTweets = await this.fetchUserTweets(account);
          newTweets.push(...userTweets);
        } catch {
          // already logged
        }
      }

      newTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      for (const tweet of newTweets) {
        await this.processTweet(tweet);
      }

      this.lastFetchTime = new Date().toISOString();
      return newTweets;
    } finally {
      this.isFetching = false;
    }
  }

  async fetchUserTweets(username) {
    if (!this.apiKey) throw new Error('TwitterAPI.io API key not configured');

    const client = axios.create({
      baseURL: 'https://api.twitterapi.io',
      headers: {
        'x-api-key': this.apiKey  // ✅ FIXED HEADER
      },
      timeout: 12_000
    });

    try {
      const sinceId = this.lastSeenIdByUser[username];
      const params = {
        limit: 10,
        ...(sinceId ? { since_id: sinceId } : {})
      };

      const tweetsResp = await client.get(`/tweets/user/${encodeURIComponent(username)}`, { params });

      const raw = tweetsResp?.data?.data || [];
      if (!Array.isArray(raw) || raw.length === 0) return [];

      const mappedTweets = raw.map(t => ({
        id: t.id_str || t.id,
        text: t.full_text || t.text,
        created_at: t.created_at || t.date,
        author: username,
        public_metrics: t.metrics || t.public_metrics || {},
        context_annotations: t.context_annotations || [],
        entities: t.entities || {},
        url: `https://x.com/${username}/status/${t.id_str || t.id}`
      }));

      if (mappedTweets.length > 0) {
        this.lastSeenIdByUser[username] = mappedTweets[0].id;
      }

      return mappedTweets;
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      console.error(`TwitterAPI.io error for ${username}${status ? ` [${status}]` : ''}: ${data ? JSON.stringify(data).slice(0, 300) : error.message}`);
      throw error;
    }
  }

  async processTweet(tweet) {
    try {
      if (this.tweets.find(t => t.id === tweet.id)) return;

      let analysis = null;
      if (this.sentimentAnalyzer?.analyzeTweet) {
        try {
          analysis = await this.sentimentAnalyzer.analyzeTweet({
            content: tweet.text,
            author: tweet.author,
            metadata: {
              created_at: tweet.created_at,
              public_metrics: tweet.public_metrics,
              context_annotations: tweet.context_annotations
            }
          });
        } catch {
          analysis = this.getFallbackAnalysis(tweet);
        }
      } else {
        analysis = this.getFallbackAnalysis(tweet);
      }

      const processedTweet = {
        ...tweet,
        analysis,
        processed_at: new Date().toISOString(),
        signal: analysis?.signal || 'PROCESSING'
      };

      this.addTweet(processedTweet);
      await this.checkTweetTriggers(processedTweet);
    } catch (error) {
      console.error('Tweet processing failed:', error?.message || error);
    }
  }

  getFallbackAnalysis(tweet) {
    return {
      sentiment: 50,
      viral: 30,
      impact: this.estimateImpactFromMetrics(tweet),
      confidence: 25,
      signal: 'PROCESSING',
      fallback: true
    };
  }

  estimateImpactFromMetrics(tweet) {
    if (!tweet.public_metrics) return 30;
    const m = tweet.public_metrics;
    const engagement = (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
    if (engagement > 10000) return 90;
    if (engagement > 1000) return 70;
    if (engagement > 100) return 50;
    return 30;
  }

  async checkTweetTriggers(tweet) {
    try {
      if (!tweet.analysis) return;
      const { sentiment, viral, impact } = tweet.analysis;

      if (impact > 85 && sentiment > 80) {
        await this.triggerAlert('HIGH_IMPACT', tweet);
      }
      if (viral > 80) {
        await this.triggerAlert('VIRAL_POTENTIAL', tweet);
      }
      if ((sentiment > 90 || sentiment < 20) && impact > 60) {
        await this.triggerAlert('MARKET_MOVING', tweet);
      }
    } catch (error) {
      console.error('Tweet trigger check failed:', error?.message || error);
    }
  }

  async triggerAlert(type, tweet) {
    const alertData = {
      type,
      tweet,
      timestamp: new Date().toISOString(),
      priority: type === 'HIGH_IMPACT' ? 'critical' : 'high'
    };
    return alertData;
  }

  addTweet(tweet) {
    this.tweets.unshift(tweet);
    if (this.tweets.length > this.maxTweets) {
      this.tweets = this.tweets.slice(0, this.maxTweets);
    }
  }

  async getRecentTweets(limit = 20) {
    try {
      return this.tweets.slice(0, limit);
    } catch {
      return [];
    }
  }

  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      accounts: this.monitoringAccounts,
      totalTweets: this.tweets.length,
      lastFetchTime: this.lastFetchTime,
      pollInterval: this.pollInterval,
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitReset: this.rateLimitReset,
      recentActivity: this.tweets.slice(0, 5).map(t => ({
        id: t.id,
        author: t.author,
        text: t.text.substring(0, 100),
        signal: t.signal,
        processed_at: t.processed_at
      }))
    };
  }

  updateRateLimitInfo(headers) {
    if (headers?.['x-rate-limit-remaining']) {
      this.rateLimitRemaining = parseInt(headers['x-rate-limit-remaining'], 10);
    }
    if (headers?.['x-rate-limit-reset']) {
      this.rateLimitReset = new Date(parseInt(headers['x-rate-limit-reset'], 10) * 1000);
    }
  }

  getTweetsByAuthor(author, limit = 10) {
    return this.tweets
      .filter(t => t.author.toLowerCase() === author.toLowerCase())
      .slice(0, limit);
  }

  getHighSentimentTweets(threshold = 80, limit = 10) {
    return this.tweets
      .filter(t => t.analysis && t.analysis.sentiment >= threshold)
      .slice(0, limit);
  }

  getTweetsBySignal(signal = 'HIGH', limit = 10) {
    return this.tweets
      .filter(t => t.signal === signal)
      .slice(0, limit);
  }

  clearOldTweets(olderThanHours = 24) {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const before = this.tweets.length;
    this.tweets = this.tweets.filter(t => new Date(t.created_at) > cutoffTime);
    return before - this.tweets.length;
  }

  getStatistics() {
    if (this.tweets.length === 0) {
      return { totalTweets: 0, averageSentiment: 0, highSignalTweets: 0, topAuthors: [] };
    }

    const totalTweets = this.tweets.length;
    const sentiments = this.tweets
      .filter(t => t.analysis && typeof t.analysis.sentiment === 'number')
      .map(t => t.analysis.sentiment);
    const avgSent = sentiments.length ? Math.round(sentiments.reduce((a, b) => a + b, 0) / sentiments.length) : 0;

    const highSignalTweets = this.tweets.filter(t => t.signal === 'HIGH').length;

    const authorCounts = {};
    this.tweets.forEach(t => { authorCounts[t.author] = (authorCounts[t.author] || 0) + 1; });
    const topAuthors = Object.entries(authorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([author, count]) => ({ author, count }));

    return {
      totalTweets,
      averageSentiment: avgSent,
      highSignalTweets,
      topAuthors,
      rateLimitInfo: {
        remaining: this.rateLimitRemaining,
        resetTime: this.rateLimitReset
      }
    };
  }
}

module.exports = TwitterMonitor;
