const axios = require('axios');

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;
    this.monitoringAccounts = [];
    this.isMonitoring = false;
    this.tweets = [];
    this.maxTweets = 100;
    this.pollInterval = 60000; // 1 minute
    this.intervalId = null;
    this.lastFetchTime = null;
    this.rateLimitRemaining = 100;
    this.rateLimitReset = null;
  }

  async start(accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor']) {
    try {
      if (this.isMonitoring) {
        console.log('Monitoring already active');
        return { success: true, message: 'Already monitoring' };
      }

      if (!this.apiKey) {
        throw new Error('Twitter API key not configured');
      }

      this.monitoringAccounts = accounts;
      this.isMonitoring = true;
      
      console.log(`Starting Twitter monitoring for accounts: ${accounts.join(', ')}`);
      
      // Initial fetch
      await this.fetchLatestTweets();
      
      // Set up polling interval
      this.intervalId = setInterval(() => {
        this.fetchLatestTweets().catch(error => {
          console.error('Polling error:', error);
        });
      }, this.pollInterval);

      return {
        success: true,
        message: 'Monitoring started',
        accounts: this.monitoringAccounts,
        pollInterval: this.pollInterval
      };
    } catch (error) {
      console.error('Failed to start monitoring:', error);
      this.isMonitoring = false;
      throw error;
    }
  }

  async stop() {
    try {
      if (!this.isMonitoring) {
        console.log('Monitoring already stopped');
        return { success: true, message: 'Already stopped' };
      }

      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      this.isMonitoring = false;
      console.log('Twitter monitoring stopped');

      return {
        success: true,
        message: 'Monitoring stopped'
      };
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
      throw error;
    }
  }

  async fetchLatestTweets() {
    try {
      if (!this.apiKey) {
        throw new Error('Twitter API key not configured');
      }

      console.log('Fetching latest tweets...');
      const newTweets = [];

      for (const account of this.monitoringAccounts) {
        try {
          const userTweets = await this.fetchUserTweets(account);
          newTweets.push(...userTweets);
        } catch (error) {
          console.error(`Failed to fetch tweets for ${account}:`, error.message);
        }
      }

      // Sort by timestamp and add to our collection
      newTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      // Process new tweets
      for (const tweet of newTweets) {
        await this.processTweet(tweet);
      }

      this.lastFetchTime = new Date().toISOString();
      console.log(`Fetched ${newTweets.length} new tweets`);

      return newTweets;
    } catch (error) {
      console.error('Failed to fetch tweets:', error);
      throw error;
    }
  }

  async fetchUserTweets(username) {
    try {
      const url = `https://api.twitterapi.io/v2/users/by/username/${username}`;
      
      const userResponse = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 10000
      });

      if (!userResponse.data || !userResponse.data.data) {
        throw new Error(`No user data found for ${username}`);
      }

      const userId = userResponse.data.data.id;
      
      // Get user's recent tweets
      const tweetsUrl = `https://api.twitterapi.io/v2/users/${userId}/tweets`;
      
      const tweetsResponse = await axios.get(tweetsUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        params: {
          'max_results': 10,
          'tweet.fields': 'created_at,public_metrics,context_annotations,entities',
          'user.fields': 'username,verified,public_metrics'
        },
        timeout: 10000
      });

      // Update rate limit info
      this.updateRateLimitInfo(tweetsResponse.headers);

      if (!tweetsResponse.data || !tweetsResponse.data.data) {
        console.log(`No tweets found for ${username}`);
        return [];
      }

      return tweetsResponse.data.data.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
        author: username,
        public_metrics: tweet.public_metrics,
        context_annotations: tweet.context_annotations,
        entities: tweet.entities,
        url: `https://twitter.com/${username}/status/${tweet.id}`
      }));

    } catch (error) {
      if (error.response) {
        console.error(`Twitter API error for ${username}:`, error.response.status, error.response.data);
        
        // Handle rate limiting
        if (error.response.status === 429) {
          const resetTime = error.response.headers['x-rate-limit-reset'];
          if (resetTime) {
            this.rateLimitReset = new Date(parseInt(resetTime) * 1000);
            console.log(`Rate limit exceeded. Reset at: ${this.rateLimitReset}`);
          }
        }
      } else {
        console.error(`Network error for ${username}:`, error.message);
      }
      throw error;
    }
  }

  async processTweet(tweet) {
    try {
      // Check if we already have this tweet
      const existingTweet = this.tweets.find(t => t.id === tweet.id);
      if (existingTweet) {
        return;
      }

      console.log(`Processing tweet from @${tweet.author}: "${tweet.text.substring(0, 50)}..."`);

      // Analyze sentiment if analyzer is available
      let analysis = null;
      if (this.sentimentAnalyzer) {
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
        } catch (error) {
          console.error('Tweet analysis failed:', error);
          analysis = this.getFallbackAnalysis(tweet);
        }
      } else {
        analysis = this.getFallbackAnalysis(tweet);
      }

      // Add processed tweet to our collection
      const processedTweet = {
        ...tweet,
        analysis,
        processed_at: new Date().toISOString(),
        signal: analysis ? analysis.signal : 'PROCESSING'
      };

      this.addTweet(processedTweet);

      // Check if this tweet triggers any alerts
      await this.checkTweetTriggers(processedTweet);

    } catch (error) {
      console.error('Tweet processing failed:', error);
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
    
    const metrics = tweet.public_metrics;
    const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0);
    
    // Simple impact estimation based on engagement
    if (engagement > 10000) return 90;
    if (engagement > 1000) return 70;
    if (engagement > 100) return 50;
    return 30;
  }

  async checkTweetTriggers(tweet) {
    try {
      if (!tweet.analysis) return;

      const { sentiment, viral, impact, signal } = tweet.analysis;

      // High impact tweet trigger
      if (impact > 85 && sentiment > 80) {
        console.log(`🚨 HIGH IMPACT TWEET DETECTED from @${tweet.author}`);
        console.log(`Signal: ${signal}, Impact: ${impact}, Sentiment: ${sentiment}`);
        
        // This would trigger token creation in a full implementation
        await this.triggerAlert('HIGH_IMPACT', tweet);
      }

      // Viral potential trigger
      if (viral > 80) {
        console.log(`📈 HIGH VIRAL POTENTIAL from @${tweet.author}`);
        await this.triggerAlert('VIRAL_POTENTIAL', tweet);
      }

      // Market moving sentiment
      if ((sentiment > 90 || sentiment < 20) && impact > 60) {
        console.log(`💰 MARKET MOVING SENTIMENT from @${tweet.author}`);
        await this.triggerAlert('MARKET_MOVING', tweet);
      }

    } catch (error) {
      console.error('Tweet trigger check failed:', error);
    }
  }

  async triggerAlert(type, tweet) {
    // In a full implementation, this would:
    // 1. Send notifications
    // 2. Log to database
    // 3. Trigger token creation pipeline
    // 4. Update dashboard in real-time
    
    console.log(`ALERT [${type}]: Tweet ${tweet.id} from @${tweet.author}`);
    
    // For now, just emit a console alert
    const alertData = {
      type,
      tweet,
      timestamp: new Date().toISOString(),
      priority: type === 'HIGH_IMPACT' ? 'critical' : 'high'
    };

    // This could be expanded to send webhooks, notifications, etc.
    return alertData;
  }

  addTweet(tweet) {
    this.tweets.unshift(tweet); // Add to beginning of array
    
    // Keep only the most recent tweets
    if (this.tweets.length > this.maxTweets) {
      this.tweets = this.tweets.slice(0, this.maxTweets);
    }
  }

  // Method that index.js calls to get recent tweets
  async getRecentTweets(limit = 20) {
    try {
      return this.tweets.slice(0, limit);
    } catch (error) {
      console.error('Failed to get recent tweets:', error);
      return [];
    }
  }

  // Method that index.js calls to get monitoring status
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      accounts: this.monitoringAccounts,
      totalTweets: this.tweets.length,
      lastFetchTime: this.lastFetchTime,
      pollInterval: this.pollInterval,
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitReset: this.rateLimitReset,
      recentActivity: this.tweets.slice(0, 5).map(tweet => ({
        id: tweet.id,
        author: tweet.author,
        text: tweet.text.substring(0, 100),
        signal: tweet.signal,
        processed_at: tweet.processed_at
      }))
    };
  }

  updateRateLimitInfo(headers) {
    if (headers['x-rate-limit-remaining']) {
      this.rateLimitRemaining = parseInt(headers['x-rate-limit-remaining']);
    }
    if (headers['x-rate-limit-reset']) {
      this.rateLimitReset = new Date(parseInt(headers['x-rate-limit-reset']) * 1000);
    }
  }

  // Get tweets by specific author
  getTweetsByAuthor(author, limit = 10) {
    return this.tweets
      .filter(tweet => tweet.author.toLowerCase() === author.toLowerCase())
      .slice(0, limit);
  }

  // Get tweets with high sentiment
  getHighSentimentTweets(threshold = 80, limit = 10) {
    return this.tweets
      .filter(tweet => tweet.analysis && tweet.analysis.sentiment >= threshold)
      .slice(0, limit);
  }

  // Get tweets by signal type
  getTweetsBySignal(signal = 'HIGH', limit = 10) {
    return this.tweets
      .filter(tweet => tweet.signal === signal)
      .slice(0, limit);
  }

  // Clear old tweets
  clearOldTweets(olderThanHours = 24) {
    const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
    const initialCount = this.tweets.length;
    
    this.tweets = this.tweets.filter(tweet => 
      new Date(tweet.created_at) > cutoffTime
    );
    
    const removedCount = initialCount - this.tweets.length;
    console.log(`Cleared ${removedCount} old tweets (older than ${olderThanHours} hours)`);
    
    return removedCount;
  }

  // Get monitoring statistics
  getStatistics() {
    if (this.tweets.length === 0) {
      return {
        totalTweets: 0,
        averageSentiment: 0,
        highSignalTweets: 0,
        topAuthors: []
      };
    }

    const totalTweets = this.tweets.length;
    const averageSentiment = this.tweets
      .filter(tweet => tweet.analysis && tweet.analysis.sentiment)
      .reduce((sum, tweet) => sum + tweet.analysis.sentiment, 0) / totalTweets;
    
    const highSignalTweets = this.tweets.filter(tweet => tweet.signal === 'HIGH').length;
    
    // Count tweets by author
    const authorCounts = {};
    this.tweets.forEach(tweet => {
      authorCounts[tweet.author] = (authorCounts[tweet.author] || 0) + 1;
    });
    
    const topAuthors = Object.entries(authorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([author, count]) => ({ author, count }));

    return {
      totalTweets,
      averageSentiment: Math.round(averageSentiment || 0),
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
