const axios = require('axios');

// ---- Hard-coded IDs (no lookups; stable even if handles change)
const ID_MAP = {
  elonmusk:       '44196397',
  vitalikbuterin: '295218901',
  michael_saylor: '244647486',
  justinsuntron:  '1023900737',
  cz_binance:     '888059910',
  naval:          '745273',
  APompliano:     '361289499',
  balajis:        '36563169',
  coinbureau:     '1109836680455862273',
  WhalePanda:     '14198485'
};

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;

    this.monitoringAccounts = [];  // [{ id, label }]
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
    this.lastSeenIdByUser = {}; // key=id -> since_id

    // default list uses known handles; we immediately map to IDs from ID_MAP
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

  // Accepts mix of handles and numeric IDs; prefers hard-coded IDs; skips any unknown handle
  async start(accounts = []) {
    if (this.isMonitoring) return { success: true, message: 'Already monitoring' };
    if (!this.apiKey) throw new Error('TwitterAPI.io API key not configured');

    const targets = [];
    const unique = [...new Set(accounts)].map(v => String(v).trim()).filter(Boolean);

    for (const v of unique) {
      if (/^\d+$/.test(v)) { // numeric id provided
        targets.push({ id: v, label: v });
        continue;
      }
      const handle = v.replace(/^@/, '');
      const id = ID_MAP[handle] || ID_MAP[handle.toLowerCase()];
      if (id) {
        console.log(`🔒 Using hard-coded ID for @${handle} -> ${id} (local-map)`);
        targets.push({ id, label: handle });
      } else {
        console.warn(`⏭️ Skipping @${handle}: not in local ID map (no lookups in this mode)`);
      }
    }

    if (targets.length === 0) {
      throw new Error('No valid accounts after applying hard-coded ID map.');
    }

    this.monitoringAccounts = targets;
    this.isMonitoring = true;

    await this.fetchLatestTweets();

    this.intervalId = setInterval(async () => {
      try { if (!this.isFetching) await this.fetchLatestTweets(); } catch {}
    }, this.pollInterval);

    return {
      success: true,
      message: 'Monitoring started (local-map mode)',
      accounts: this.monitoringAccounts,
      pollInterval: this.pollInterval
    };
  }

  async stop() {
    if (!this.isMonitoring) return { success: true, message: 'Already stopped' };
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
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

    const key = target.id; // in this mode we always have an id
    const sinceId = this.lastSeenIdByUser[key];
    const params = { limit: 10, ...(sinceId ? { since_id: sinceId } : {}) };

    // Prefer ID endpoint; if provider lacks it, optionally fall back to handle endpoint (rare)
    const paths = [
      `/tweets/user-id/${encodeURIComponent(key)}`,
      // fallback would require a handle; we skip since this mode is ID-only to avoid 404s:
      // `/tweets/user/${encodeURIComponent(target.label)}`
    ];

    const requestWithRetry = async (path) => {
      try {
        return await client.get(path, { params });
      } catch (err) {
        if (err?.response?.status === 429) {
          console.warn(`429 for ${key} — backoff ${this.retryBackoffMs}ms then retry once`);
          await new Promise(res => setTimeout(res, this.retryBackoffMs));
          return await client.get(path, { params });
        }
        throw err;
      }
    };

    try {
      let resp;
      for (const p of paths) {
        try { resp = await requestWithRetry(p); break; }
        catch (e) {
          const st = e?.response?.status;
          console.warn(`TwitterAPI.io error for ${key} on ${p} [${st || 'ERR'}]`);
          if (st && st !== 404) throw e; // non-404 -> abort
        }
      }
      const raw = resp?.data?.data || [];
      if (!Array.isArray(raw) || raw.length === 0) return [];

      const author = target.label || String(target.id);
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
      const data = error?.response?.data;
      const status = error?.response?.status;
      console.error(
        `TwitterAPI.io final error for ${key}${status ? ` [${status}]` : ''}: ${
          data ? JSON.stringify(data).slice(0,300) : (error.message || 'Unknown error')
        }`
      );
      return []; // swallow to keep loop healthy
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
        } catch { analysis = this.getFallbackAnalysis(tweet); }
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
    return {
      type,
      tweet,
      timestamp: new Date().toISOString(),
      priority: type === 'HIGH_IMPACT' ? 'critical' : 'high'
    };
  }

  addTweet(tweet) {
    this.tweets.unshift(tweet);
    if (this.tweets.length > this.maxTweets) {
      this.tweets = this.tweets.slice(0, this.maxTweets);
    }
  }

  async getRecentTweets(limit = 20) { return this.tweets.slice(0, limit); }

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
        id: t.id, author: t.author, text: t.text.substring(0, 100),
        signal: t.signal, processed_at: t.processed_at
      }))
    };
  }
}

module.exports = TwitterMonitor;
