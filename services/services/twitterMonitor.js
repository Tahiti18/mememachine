const axios = require('axios');

class TwitterMonitor {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.sentimentAnalyzer = options.sentimentAnalyzer;
    this.baseURL = 'https://api.twitterapi.io/v2';
    this.monitoring = false;
    this.monitoredAccounts = [];
    this.recentTweets = [];
    this.intervalId = null;
  }

  async start(accounts = ['elonmusk', 'VitalikButerin', 'michael_saylor']) {
    if (this.monitoring) {
      console.log('🐦 Twitter monitoring already active');
      return;
    }

    this.monitoredAccounts = accounts;
    this.monitoring = true;

    console.log(`🚀 Starting Twitter monitoring for: ${accounts.join(', ')}`);

    if (!this.apiKey) {
      console.log('⚠️ No Twitter API key - using demo mode');
      this.startDemoMonitoring();
      return;
    }

    // Start real monitoring
    this.intervalId = setInterval(() => {
      this.fetchTweets();
    }, 30000); // Check every 30 seconds

    // Initial fetch
    await this.fetchTweets();
  }

  async stop() {
    this.monitoring = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('🛑 Twitter monitoring stopped');
  }

  async fetchTweets() {
    if (!this.monitoring || !this.apiKey) return;

    try {
      for (const account of this.monitoredAccounts) {
        await this.fetchUserTweets(account);

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error fetching tweets:', error);
    }
  }

  async fetchUserTweets(username) {
    try {
      console.log(`📡 Fetching tweets from @${username}`);

      const response = await axios.get(`${this.baseURL}/users/by/username/${username}/tweets`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        params: {
          'tweet.fields': 'created_at,public_metrics,context_annotations',
          'max_results': 10
        }
      });

      const tweets = response.data.data || [];

      for (const tweet of tweets) {
        await this.processTweet(tweet, username);
      }

    } catch (error) {
      console.error(`Error fetching tweets for @${username}:`, error.message);
    }
  }

  async processTweet(tweetData, username) {
    try {
      // Check if we've already processed this tweet
      if (this.recentTweets.some(t => t.id === tweetData.id)) {
        return;
      }

      console.log(`📋 Processing tweet: ${tweetData.text.substring(0, 50)}...`);

      // Analyze sentiment using our AI ensemble
      const analysis = await this.sentimentAnalyzer.analyzeTweet({
        content: tweetData.text,
        author: username,
        metadata: {
          created_at: tweetData.created_at,
          public_metrics: tweetData.public_metrics,
          tweet_id: tweetData.id
        }
      });

      const processedTweet = {
        id: tweetData.id,
        author: username,
        content: tweetData.text,
        timestamp: tweetData.created_at || new Date().toISOString(),
        analysis,
        processed_at: new Date().toISOString()
      };

      // Add to recent tweets (keep last 100)
      this.recentTweets.unshift(processedTweet);
      this.recentTweets = this.recentTweets.slice(0, 100);

      // Log high-impact tweets
      if (analysis.signal === 'HIGH') {
        console.log(`🚨 HIGH SIGNAL detected from @${username}:`);
        console.log(`   Tweet: "${tweetData.text}"`);
        console.log(`   Sentiment: ${analysis.sentiment}% | Viral: ${analysis.viral}% | Impact: ${analysis.impact}%`);
      }

    } catch (error) {
      console.error('Error processing tweet:', error);
    }
  }

  startDemoMonitoring() {
    console.log('🎭 Starting demo monitoring mode');

    // Generate demo tweets periodically
    this.intervalId = setInterval(() => {
      this.generateDemoTweet();
    }, 60000); // Every minute
  }

  generateDemoTweet() {
    const demoTweets = [
      {
        author: 'elonmusk',
        content: 'The future of currency is digital and decentralized',
        sentiment: 94, viral: 89, impact: 97
      },
      {
        author: 'VitalikButerin', 
        content: 'Ethereum\'s next upgrade will revolutionize scalability',
        sentiment: 78, viral: 56, impact: 71
      },
      {
        author: 'michael_saylor',
        content: 'Bitcoin is digital energy stored in cyberspace',
        sentiment: 85, viral: 43, impact: 62
      },
      {
        author: 'cathiedwood',
        content: 'Innovation drives markets forward',
        sentiment: 65, viral: 32, impact: 48
      }
    ];

    const randomTweet = demoTweets[Math.floor(Math.random() * demoTweets.length)];

    const processedTweet = {
      id: 'demo_' + Date.now(),
      author: randomTweet.author,
      content: randomTweet.content,
      timestamp: new Date().toISOString(),
      analysis: {
        sentiment: randomTweet.sentiment + Math.floor(Math.random() * 10 - 5), // ±5 variance
        viral: randomTweet.viral + Math.floor(Math.random() * 10 - 5),
        impact: randomTweet.impact + Math.floor(Math.random() * 10 - 5),
        confidence: 0.9,
        signal: randomTweet.impact > 70 ? 'HIGH' : randomTweet.impact > 50 ? 'MEDIUM' : 'LOW'
      }
    };

    this.recentTweets.unshift(processedTweet);
    this.recentTweets = this.recentTweets.slice(0, 100);

    console.log(`🎬 Demo tweet generated from @${processedTweet.author}`);
  }

  getRecentTweets(limit = 20) {
    return this.recentTweets.slice(0, limit);
  }

  getStats() {
    return {
      monitoring: this.monitoring,
      accounts: this.monitoredAccounts,
      totalTweets: this.recentTweets.length,
      lastUpdate: this.recentTweets[0]?.processed_at || null,
      apiConnected: !!this.apiKey
    };
  }
}

module.exports = TwitterMonitor;
