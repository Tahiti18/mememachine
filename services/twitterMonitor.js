const axios = require('axios');

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;

    this.monitoringAccounts = [];
    this.isMonitoring = false;
    this.isFetching = false; // re-entrancy guard
    this.tweets = [];
    this.maxTweets = 100;

    this.pollInterval = 60_000; // 1 minute
    this.intervalId = null;
    this.lastFetchTime = null;

    this.rateLimitRemaining = 100;
    this.rateLimitReset = null;

    // Track last seen tweet per username to fetch only new items
    this.lastSeenIdByUser = {};
  }

  async start(accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor']) {
    if (this.isMonitoring) {
      return { success: true, message: 'Already monitoring' };
    }
    if (!this.apiKey) {
      throw new Error('Twitter/X API key not configured');
    }

    this.monitoringAccounts = accounts;
    this.isMonitoring = true;

    // Initial fetch
    await this.fetchLatestTweets();

    // Polling loop (guard against overlaps)
    this.intervalId = setInterval(async () => {
      try {
        if (!this.isFetching) {
          await this.fetchLatestTweets();
        }
      } catch (err) {
        // swallow interval errors; logging already handled
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
    if (!this.apiKey) throw new Error('Twitter/X API key not configured');

    if (this.isFetching) return [];
    this.isFetching = true;

    try {
      const newTweets = [];

      for (const account of this.monitoringAccounts) {
        try {
          const userTweets = await this.fetchUserTweets(account);
          newTweets.push(...userTweets);
        } catch (error) {
          // already logged inside fetchUserTweets
        }
      }

      // Sort newest first, then process
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

  /**
   * Uses official X (Twitter) v2 endpoints.
   * Note: You need a valid Bearer token with access to /2 endpoints.
   */
  async fetchUserTweets(username) {
    const client = axios.create({
      baseURL: 'https://api.x.com/2',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      timeout: 12_000
    });

    try {
      // 1) Resolve user ID
      const userResp = await client.get(`/users/by/username/${encodeURIComponent(username)}`, {
        params: { 'user.fields': 'username,verified,public_metrics' }
      });

      const user = userResp?.data?.data;
      if (!user?.id) throw new Error(`No user data for ${username}`);
      const userId = user.id;

      // 2) Fetch recent tweets, only new ones via since_id if we have it
      const sinceId = this.lastSeenIdByUser[username];
      const params = {
        max_results: 10,
        'tweet.fields': 'created_at,public_metrics,entities,context_annotations',
        // expansions could be added if you need referenced tweets/users
      };
      if (sinceId) params.since_id = sinceId;

      let tweetsResp;
      try {
        tweetsResp = await client.get(`/users/${userId}/tweets`, { params });
      } catch (err) {
        // Handle 429 with a single backoff retry
        const status = err?.response?.status;
        if (status === 429) {
          const resetHeader = err.response.headers['x-rate-limit-reset'];
          const resetMs = resetHeader ? parseInt(resetHeader, 10) * 1000 : Date.now() + 60_000;
          const delay = Math.max(1000, resetMs - Date.now() + 250); // small cushion
          await new Promise(res => setTimeout(res, delay));
          tweetsResp = await client.get(`/users/${userId}/tweets`, { params });
        } else {
          throw err;
        }
      }

      this.updateRateLimitInfo(tweetsResp.headers);

      const raw = tweetsResp?.data?.data || [];
      if (!Array.isArray(raw) || raw.length === 0) return [];

      // Update since_id with newest tweet id we got
      const newest = raw[0];
      if (newest?.id) this.lastSeenIdByUser[username] = newest.id;

      return raw.map(t => ({
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        author: username,
        public_metrics: t.public_metrics,
        context_annotations: t.context_annotations,
        entities: t.entities,
        url: `https://x.com/${username}/status/${t.id}`
      }));
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      // Keep logs terse; upstream will aggregate
      console.error(`X API error for ${username}${status ? ` [${status}]` : ''}: ${data ? JSON.stringify(data).slice(0, 300) : error.message}`);
      // Rate-limit metadata if present
      if (status === 429) {
        const resetTime = error.response.headers['x-rate-limit-reset'];
        if (resetTime) {
          this.rateLimitReset = new Date(parseInt(resetTime, 10) * 1000);
        }
      }
      throw error;
    }
  }

  async processTweet(tweet) {
    try {
      // de-dupe
      if (this.tweets.find(t => t.id === tweet.id)) return;

      // Analyze sentiment (fallback if analyzer throws)
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
        } catch (e) {
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
      const { sentiment, viral, impact, signal } = tweet.analysis;

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
    // TODO: emit webhook / persist in DB / notify pipeline
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
