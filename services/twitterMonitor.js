const axios = require('axios');
const { resolveHandleToIdWithSource } = require('./twitterUserResolver');

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;

    this.monitoringAccounts = [];      // [{ id?: string, handle?: string, label: string }]
    this.resolutionCache = {};         // handle -> id
    this.resolutionSource = {};        // handle -> source (e.g., local-map)
    this.isMonitoring = false;
    this.isFetching = false;
    this.tweets = [];
    this.maxTweets = 100;

    // pacing (env)
    const envPoll = parseInt(process.env.TWEET_CHECK_INTERVAL || '60000', 10);
    this.pollInterval = Math.max(30000, isNaN(envPoll) ? 60000 : envPoll);
    const envGap = parseInt(process.env.PER_REQUEST_GAP_MS || '7000', 10);
    this.perRequestGapMs = Math.max(5500, isNaN(envGap) ? 7000 : envGap);
    const envRetry = parseInt(process.env.RETRY_BACKOFF_MS || `${this.pollInterval}`, 10);
    this.retryBackoffMs = Math.max(this.perRequestGapMs, isNaN(envRetry) ? this.pollInterval : envRetry);

    this.intervalId = null;
    this.lastFetchTime = null;
    this.rateLimitRemaining = 100;
    this.rateLimitReset = null;
    this.lastSeenIdByUser = {}; // key = id or handle -> since_id

    const defaultHandles = [
      'elonmusk','vitalikbuterin','michael_saylor','justinsuntron',
      'cz_binance','naval','APompliano','balajis','coinbureau','WhalePanda'
    ];
    const envList = (process.env.TWITTER_ACCOUNTS || defaultHandles.join(','))
      .split(',').map(s => s.trim()).filter(Boolean);

    if (this.apiKey) {
      console.log('🚀 Auto-starting Twitter monitoring...');
      this.start(envList)
        .then(() => console.log('✅ Twitter monitoring started automatically'))
        .catch(err => console.error('❌ Failed to auto-start monitoring:', err?.message || err));
    } else {
      console.warn('⚠️ No TwitterAPI.io key found — monitoring not started.');
    }
  }

  // accepts mix of handles and numeric IDs
  async start(accounts = []) {
    if (this.isMonitoring) return { success: true, message: 'Already monitoring' };
    if (!this.apiKey) throw new Error('TwitterAPI.io API key not configured');

    const rawTargets = [...new Set(accounts)].map(s => String(s).trim()).filter(Boolean);
    const targets = [];

    for (let i = 0; i < rawTargets.length; i++) {
      const v = rawTargets[i];
      if (/^\d+$/.test(v)) { // already numeric ID
        targets.push({ id: v, label: v });
        continue;
      }
      const handle = v.replace(/^@/, '').toLowerCase();

      if (!this.resolutionCache[handle]) {
        if (i > 0) await new Promise(r => setTimeout(r, this.perRequestGapMs));
        const { id: resolvedId, source } = await resolveHandleToIdWithSource(handle);
        if (resolvedId) {
          this.resolutionCache[handle] = resolvedId;
          this.resolutionSource[handle] = source || 'local-map';
          console.log(`🔎 Resolved @${handle} -> ${resolvedId} (${this.resolutionSource[handle]})`);
        } else {
          console.warn(`⚠️ Could not resolve @${handle} to ID (will call by handle, may 404)`);
        }
      }
      const id = this.resolutionCache[handle];
      targets.push(id ? { id, label: handle } : { handle, label: handle });
    }

    this.monitoringAccounts = targets;
    this.isMonitoring = true;

    await this.fetchLatestTweets();

    this.intervalId = setInterval(async () => {
      try { if (!this.isFetching) await this.fetchLatestTweets(); } catch {}
    }, this.pollInterval);

    return {
      success: true,
      message: 'Monitoring started',
      accounts: this.monitoringAccounts,
      pollInterval: this.pollInterval
    };
  }

  async stop() {
    if (!this.isMonitoring) return { success: true, message: 'Already stopped' };
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
      for (let i = 0; i < this.monitoringAccounts.length; i++) {
        const target = this.monitoringAccounts[i];
        try {
          if (i > 0) await new Promise(r => setTimeout(r, this.perRequestGapMs));
          const userTweets = await this.fetchTweetsForTarget(target);
          newTweets.push(...userTweets);
        } catch { /* logged inside */ }
      }

      newTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      for (const t of newTweets) await this.processTweet(t);

      this.lastFetchTime = new Date().toISOString();
      return newTweets;
    } finally {
      this.isFetching = false;
    }
  }

  async fetchTweetsForTarget(target) {
    const client = axios.create({
      baseURL: 'https://api.twitterapi.io',
      headers: { 'x-api-key': this.apiKey },
      timeout: 12000
    });

    const key = target.id || target.handle;
    const path = target.id
      ? `/tweets/user-id/${encodeURIComponent(target.id)}`
      : `/tweets/user/${encodeURIComponent(target.handle)}`;
    const sinceId = this.lastSeenIdByUser[key];
    const params = { limit: 10, ...(sinceId ? { since_id: sinceId } : {}) };

    const requestWithRetry = async () => {
      try {
        return await client.get(path, { params });
      } catch (err) {
        if (err?.response?.status === 429) {
          console.warn(`429 for ${key} — backing off ${this.retryBackoffMs}ms then retrying once`);
          await new Promise(res => setTimeout(res, this.retryBackoffMs));
          return await client.get(path, { params });
        }
        throw err;
      }
    };

    try {
      const resp = await requestWithRetry();
      const raw = resp?.data?.data || [];
      if (!Array.isArray(raw) || raw.length === 0) return [];

      const author = target.label || target.handle || String(target.id);
      const mapped = raw.map(t => ({
        id: t.id_str || t.id,
        text: t.full_text || t.text,
        created_at: t.created_at || t.date,
        author,
        public_metrics: t.metrics || t.public_metrics || {},
        context_annotations: t.context_annotations || [],
        entities: t.entities || {},
        url: `https://x.com/${author}/status/${t.id_str || t.id}`
      }));

      if (mapped.length > 0) this.lastSeenIdByUser[key] = mapped[0].id;
      return mapped;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 404 && target.handle) {
        // drop cached mapping and try to re-resolve next cycle
        delete this.resolutionCache[target.handle];
        console.warn(`User not found on TwitterAPI.io: ${key} — will re-resolve handle next cycle`);
        return [];
      }
      const data = error?.response?.data;
      console.error(
        `TwitterAPI.io error for ${key}${status ? ` [${status}]` : ''}: ${
          data ? JSON.stringify(data).slice(0,300) : (error.message || 'Unknown error')
        }`
      );
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
    const engagement =
      (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
    if (engagement > 10000) return 90;
    if (engagement > 1000) return 70;
    if (engagement > 100) return 50;
    return 30;
  }

  async checkTweetTriggers(tweet) {
    try {
      if (!tweet.analysis) return;
      const { sentiment, viral, impact } = tweet.analysis;

      if (impact > 85 && sentiment > 80) await this.triggerAlert('HIGH_IMPACT', tweet);
      if (viral > 80) await this.triggerAlert('VIRAL_POTENTIAL', tweet);
      if ((sentiment > 90 || sentiment < 20) && impact > 60)
        await this.triggerAlert('MARKET_MOVING', tweet);
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
    const avgSent = sentiments.length
      ? Math.round(sentiments.reduce((a, b) => a + b, 0) / sentiments.length)
      : 0;

    const highSignalTweets = this.tweets.filter(t => t.signal === 'HIGH').length;

    const authorCounts = {};
    this.tweets.forEach(t => {
      authorCounts[t.author] = (authorCounts[t.author] || 0) + 1;
    });
    const topAuthors = Object.entries(authorCounts)
      .sort(([, a], [, b]) => b - a)
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
