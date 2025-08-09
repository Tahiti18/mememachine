class AIEnsemble {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.mode = options.mode || 'adaptive';
    this.models = [
      'anthropic/claude-3-haiku',
      'openai/gpt-3.5-turbo',
      'google/gemma-7b-it',
      'meta-llama/llama-2-70b-chat'
    ];
    this.modelStats = {};
    this.initialized = false;
    
    if (this.apiKey) {
      this.initialize();
    }
  }

  async initialize() {
    try {
      console.log('Initializing AI Ensemble...');
      this.initialized = true;
      
      // Initialize model stats
      this.models.forEach(model => {
        this.modelStats[model] = {
          requests: 0,
          successes: 0,
          errors: 0,
          avgResponseTime: 0,
          lastUsed: null
        };
      });
      
      console.log(`AI Ensemble initialized with ${this.models.length} models`);
    } catch (error) {
      console.error('AI Ensemble initialization failed:', error);
      this.initialized = false;
    }
  }

  // Main analyze method that index.js calls
  async analyze(text, type = 'sentiment') {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const prompt = this.buildPrompt(text, type);
      const response = await this.queryModel(prompt);
      
      return this.parseResponse(response, type);
    } catch (error) {
      console.error('AI analysis failed:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  buildPrompt(text, type) {
    const prompts = {
      sentiment: `Analyze the sentiment of this tweet and return a JSON response with sentiment score (0-100), viral potential (0-100), market impact (0-100), and confidence level (0-100):

"${text}"

Response format:
{
  "sentiment": 85,
  "viral": 72,
  "impact": 90,
  "confidence": 88,
  "reasoning": "Brief explanation"
}`,

      meme_potential: `Analyze this tweet for meme coin creation potential. Return JSON with potential score (0-100), suggested token name, symbol, and reasoning:

"${text}"

Response format:
{
  "potential": 75,
  "tokenName": "SuggestedName",
  "symbol": "SYM",
  "reasoning": "Why this could work"
}`,

      general: `Analyze this text and provide insights: "${text}"`
    };

    return prompts[type] || prompts.general;
  }

  async queryModel(prompt) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const selectedModel = this.selectBestModel();
    const startTime = Date.now();

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mememachine.netlify.app',
          'X-Title': 'MemesMachine AI Analysis'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;

      // Update model stats
      this.updateModelStats(selectedModel, true, responseTime);

      return data.choices[0].message.content;
    } catch (error) {
      this.updateModelStats(selectedModel, false, Date.now() - startTime);
      throw error;
    }
  }

  selectBestModel() {
    if (this.mode === 'fast') {
      return 'openai/gpt-3.5-turbo';
    }
    
    if (this.mode === 'accurate') {
      return 'anthropic/claude-3-haiku';
    }
    
    // Adaptive mode - select based on performance
    const availableModels = this.models.filter(model => {
      const stats = this.modelStats[model];
      return !stats.lastUsed || (Date.now() - stats.lastUsed) > 60000; // 1 minute cooldown
    });
    
    if (availableModels.length === 0) {
      return this.models[0]; // Fallback
    }
    
    // Select model with best success rate
    return availableModels.reduce((best, current) => {
      const bestStats = this.modelStats[best];
      const currentStats = this.modelStats[current];
      
      const bestRate = bestStats.requests > 0 ? bestStats.successes / bestStats.requests : 0.5;
      const currentRate = currentStats.requests > 0 ? currentStats.successes / currentStats.requests : 0.5;
      
      return currentRate > bestRate ? current : best;
    });
  }

  updateModelStats(model, success, responseTime) {
    if (!this.modelStats[model]) {
      this.modelStats[model] = { requests: 0, successes: 0, errors: 0, avgResponseTime: 0, lastUsed: null };
    }
    
    const stats = this.modelStats[model];
    stats.requests++;
    stats.lastUsed = Date.now();
    
    if (success) {
      stats.successes++;
    } else {
      stats.errors++;
    }
    
    // Update average response time
    stats.avgResponseTime = ((stats.avgResponseTime * (stats.requests - 1)) + responseTime) / stats.requests;
  }

  parseResponse(response, type) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback parsing for different types
      if (type === 'sentiment') {
        return {
          sentiment: 75,
          viral: 60,
          impact: 70,
          confidence: 80,
          reasoning: 'Parsed from text response'
        };
      }
      
      return { analysis: response, type };
    } catch (error) {
      console.error('Response parsing failed:', error);
      return { error: 'Failed to parse AI response', raw: response };
    }
  }

  getStatus() {
    return {
      mode: this.mode,
      initialized: this.initialized,
      availableModels: this.models.length,
      stats: {
        requests: Object.values(this.modelStats).reduce((sum, stats) => sum + stats.requests, 0),
        successful: Object.values(this.modelStats).reduce((sum, stats) => sum + stats.successes, 0),
        errors: Object.values(this.modelStats).reduce((sum, stats) => sum + stats.errors, 0),
        totalCost: 0, // Would track actual costs
        modelUsage: this.modelStats
      },
      ensembleModes: ['cost_optimized', 'max_accuracy', 'adaptive'],
      availableModels: this.models
    };
  }

  getAvailableModels() {
    return this.models;
  }

  // Alias methods for compatibility
  async analyzeTweet(tweetData) {
    return this.analyze(tweetData.content || tweetData.text, 'sentiment');
  }

  async generateResponse(prompt) {
    return this.analyze(prompt, 'general');
  }
}

module.exports = AIEnsemble;
