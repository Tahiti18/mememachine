const axios = require('axios');

class AIEnsemble {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.mode = options.mode || 'adaptive';
    this.baseURL = 'https://openrouter.ai/api/v1';

    // Model configurations for different scenarios
    this.modelConfigs = {
      // Ultra-cheap models for initial screening
      screening: [
        'deepseek/deepseek-r1',
        'qwen/qwen-2.5-72b-instruct', 
        'mistral/mistral-7b-instruct'
      ],

      // Balanced cost/accuracy models
      analysis: [
        'anthropic/claude-3-haiku',
        'google/gemini-pro-1.5',
        'meta-llama/llama-3.1-70b'
      ],

      // High-accuracy models for validation
      validation: [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o-mini',
        'google/gemini-2.0-flash-exp'
      ]
    };

    // Ensemble modes
    this.ensembleModes = {
      cost_optimized: {
        primary: 'deepseek/deepseek-r1',
        validation: 'anthropic/claude-3-haiku',
        emergency: 'qwen/qwen-2.5-72b-instruct'
      },

      max_accuracy: {
        ensemble: [
          'anthropic/claude-3.5-sonnet',
          'openai/gpt-4o-mini', 
          'google/gemini-2.0-flash-exp',
          'deepseek/deepseek-r1'
        ],
        voting: 'weighted_consensus'
      },

      adaptive: {
        lowValue: 'deepseek/deepseek-r1',
        mediumValue: ['anthropic/claude-3-haiku', 'google/gemini-2.0-flash-exp'],
        highValue: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'google/gemini-2.0-flash-exp']
      }
    };

    this.stats = {
      requests: 0,
      successful: 0,
      errors: 0,
      totalCost: 0,
      modelUsage: {}
    };
  }

  async analyzeWithEnsemble(prompt, context = {}) {
    try {
      const config = this.ensembleModes[this.mode];

      if (this.mode === 'cost_optimized') {
        return await this.costOptimizedAnalysis(prompt, config, context);
      } else if (this.mode === 'max_accuracy') {
        return await this.maxAccuracyAnalysis(prompt, config, context);
      } else if (this.mode === 'adaptive') {
        return await this.adaptiveAnalysis(prompt, config, context);
      }

      throw new Error(`Unknown ensemble mode: ${this.mode}`);

    } catch (error) {
      console.error('Ensemble analysis error:', error);
      this.stats.errors++;
      throw error;
    }
  }

  async costOptimizedAnalysis(prompt, config, context) {
    console.log('🤑 Using cost-optimized ensemble');

    try {
      // Try primary model first (cheapest)
      const result = await this.callModel(config.primary, prompt, context);

      // If confidence is low, validate with better model
      if (result.confidence < 0.85) {
        console.log('⚡ Low confidence, validating with better model');
        const validation = await this.callModel(config.validation, prompt, context);

        // Combine results
        return this.combineResults([result, validation], 'weighted');
      }

      return result;

    } catch (error) {
      console.log('🚨 Primary model failed, using emergency fallback');
      return await this.callModel(config.emergency, prompt, context);
    }
  }

  async maxAccuracyAnalysis(prompt, config, context) {
    console.log('🎯 Using maximum accuracy ensemble');

    const promises = config.ensemble.map(model => 
      this.callModel(model, prompt, context).catch(error => {
        console.warn(`Model ${model} failed:`, error.message);
        return null;
      })
    );

    const results = await Promise.all(promises);
    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      throw new Error('All models failed');
    }

    return this.combineResults(validResults, config.voting);
  }

  async adaptiveAnalysis(prompt, config, context) {
    console.log('🧠 Using adaptive ensemble');

    // Determine importance/complexity
    const importance = this.assessImportance(prompt, context);

    let models;
    if (importance === 'high') {
      models = config.highValue;
      console.log('📈 High importance detected - using premium models');
    } else if (importance === 'medium') {
      models = config.mediumValue;
      console.log('📊 Medium importance detected - using balanced models');
    } else {
      models = [config.lowValue];
      console.log('📉 Low importance detected - using cost-effective model');
    }

    if (Array.isArray(models)) {
      // Multiple models - ensemble approach
      const promises = models.map(model => 
        this.callModel(model, prompt, context).catch(() => null)
      );

      const results = await Promise.all(promises);
      const validResults = results.filter(r => r !== null);

      return this.combineResults(validResults, 'weighted');
    } else {
      // Single model
      return await this.callModel(models, prompt, context);
    }
  }

  async callModel(modelId, prompt, context) {
    this.stats.requests++;

    const payload = {
      model: modelId,
      messages: [
        {
          role: 'system',
          content: 'You are an expert cryptocurrency sentiment analyst. Analyze tweets for sentiment, viral potential, and market impact. Return structured JSON with confidence scores.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    };

    try {
      console.log(`🤖 Calling model: ${modelId}`);

      const response = await axios.post(`${this.baseURL}/chat/completions`, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://memesmachine.netlify.app',
          'X-Title': 'MemesMachine AI Ensemble'
        },
        timeout: 30000
      });

      const result = this.parseModelResponse(response.data, modelId);

      // Update stats
      this.stats.successful++;
      this.stats.modelUsage[modelId] = (this.stats.modelUsage[modelId] || 0) + 1;

      if (response.data.usage) {
        // Estimate cost (rough approximation)
        const estimatedCost = this.estimateCost(modelId, response.data.usage);
        this.stats.totalCost += estimatedCost;
      }

      return result;

    } catch (error) {
      console.error(`Model ${modelId} failed:`, error.response?.data || error.message);
      this.stats.errors++;
      throw new Error(`Model ${modelId} failed: ${error.message}`);
    }
  }

  parseModelResponse(response, modelId) {
    try {
      const content = response.choices[0].message.content;

      // Try to parse JSON response
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        // If not JSON, create structured response
        parsed = this.extractSentimentFromText(content);
      }

      return {
        ...parsed,
        model: modelId,
        confidence: parsed.confidence || this.calculateConfidence(parsed),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error parsing model response:', error);
      return {
        sentiment: 50,
        viral: 30,
        impact: 40,
        confidence: 0.3,
        model: modelId,
        error: 'Failed to parse response'
      };
    }
  }

  extractSentimentFromText(text) {
    // Simple text parsing for sentiment analysis
    const bullishWords = ['positive', 'bullish', 'good', 'great', 'excellent', 'up', 'rise', 'gain'];
    const bearishWords = ['negative', 'bearish', 'bad', 'terrible', 'down', 'fall', 'loss'];
    const viralWords = ['viral', 'trending', 'popular', 'share', 'retweet', 'engagement'];

    const lowerText = text.toLowerCase();

    const bullishCount = bullishWords.filter(word => lowerText.includes(word)).length;
    const bearishCount = bearishWords.filter(word => lowerText.includes(word)).length;
    const viralCount = viralWords.filter(word => lowerText.includes(word)).length;

    const sentiment = Math.max(10, Math.min(90, 50 + (bullishCount - bearishCount) * 10));
    const viral = Math.max(10, Math.min(90, 30 + viralCount * 15));
    const impact = Math.max(10, Math.min(90, (sentiment + viral) / 2));

    return { sentiment, viral, impact };
  }

  combineResults(results, method = 'weighted') {
    if (results.length === 1) return results[0];

    console.log(`🔗 Combining ${results.length} results using ${method} method`);

    if (method === 'weighted_consensus' || method === 'weighted') {
      return this.weightedConsensus(results);
    } else if (method === 'simple') {
      return this.simpleAverage(results);
    }

    return this.weightedConsensus(results);
  }

  weightedConsensus(results) {
    const weights = results.map(r => r.confidence || 0.5);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) return results[0];

    const weighted = {
      sentiment: 0,
      viral: 0, 
      impact: 0,
      confidence: 0
    };

    results.forEach((result, i) => {
      const weight = weights[i] / totalWeight;
      weighted.sentiment += (result.sentiment || 50) * weight;
      weighted.viral += (result.viral || 30) * weight;
      weighted.impact += (result.impact || 40) * weight;
      weighted.confidence += (result.confidence || 0.5) * weight;
    });

    return {
      ...weighted,
      models: results.map(r => r.model),
      ensembleMethod: 'weighted_consensus',
      timestamp: new Date().toISOString()
    };
  }

  simpleAverage(results) {
    const avg = {
      sentiment: 0,
      viral: 0,
      impact: 0,
      confidence: 0
    };

    results.forEach(result => {
      avg.sentiment += result.sentiment || 50;
      avg.viral += result.viral || 30;
      avg.impact += result.impact || 40;
      avg.confidence += result.confidence || 0.5;
    });

    Object.keys(avg).forEach(key => {
      avg[key] /= results.length;
    });

    return {
      ...avg,
      models: results.map(r => r.model),
      ensembleMethod: 'simple_average',
      timestamp: new Date().toISOString()
    };
  }

  assessImportance(prompt, context) {
    const highImportanceKeywords = [
      'elon', 'musk', 'tesla', 'bitcoin', 'crypto', 'dogecoin',
      'announcement', 'breaking', 'major', 'partnership'
    ];

    const mediumImportanceKeywords = [
      'ethereum', 'solana', 'defi', 'nft', 'altcoin', 'blockchain'
    ];

    const lowerPrompt = prompt.toLowerCase();

    const highMatches = highImportanceKeywords.filter(word => 
      lowerPrompt.includes(word)
    ).length;

    const mediumMatches = mediumImportanceKeywords.filter(word => 
      lowerPrompt.includes(word)
    ).length;

    // Consider time context (market hours, etc.)
    const hour = new Date().getHours();
    const isMarketHours = hour >= 9 && hour <= 16; // EST market hours

    if (highMatches > 0 || (context.author === 'elonmusk')) {
      return 'high';
    } else if (mediumMatches > 0 || isMarketHours) {
      return 'medium';
    }

    return 'low';
  }

  calculateConfidence(result) {
    // Simple confidence calculation
    const sentiment = result.sentiment || 50;
    const viral = result.viral || 30;
    const impact = result.impact || 40;

    // Higher values generally indicate more confidence
    const avgScore = (sentiment + viral + impact) / 3;
    const variance = Math.abs(sentiment - avgScore) + Math.abs(viral - avgScore) + Math.abs(impact - avgScore);

    // Lower variance = higher confidence
    return Math.max(0.3, Math.min(0.95, (100 - variance) / 100));
  }

  estimateCost(modelId, usage) {
    // Rough cost estimates per 1M tokens (in USD)
    const costEstimates = {
      'deepseek/deepseek-r1': 0.14,
      'qwen/qwen-2.5-72b-instruct': 0.50,
      'anthropic/claude-3-haiku': 0.25,
      'anthropic/claude-3.5-sonnet': 3.00,
      'openai/gpt-4o-mini': 0.15,
      'google/gemini-2.0-flash-exp': 0.075,
      'google/gemini-pro-1.5': 0.50
    };

    const costPerMillion = costEstimates[modelId] || 1.0;
    const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

    return (totalTokens / 1000000) * costPerMillion;
  }

  getAvailableModels() {
    const allModels = [
      ...this.modelConfigs.screening,
      ...this.modelConfigs.analysis,
      ...this.modelConfigs.validation
    ];
    return [...new Set(allModels)];
  }

  getStatus() {
    return {
      mode: this.mode,
      stats: this.stats,
      availableModels: this.getAvailableModels().length,
      modelConfigs: Object.keys(this.modelConfigs),
      ensembleModes: Object.keys(this.ensembleModes)
    };
  }

  resetStats() {
    this.stats = {
      requests: 0,
      successful: 0,
      errors: 0,
      totalCost: 0,
      modelUsage: {}
    };
  }
}

module.exports = AIEnsemble;
