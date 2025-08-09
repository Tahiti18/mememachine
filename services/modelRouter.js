class ModelRouter {
  constructor() {
    this.stats = {
      totalRequests: 0,
      modelSelections: {},
      performanceMetrics: {},
      averageResponseTime: 0,
      totalCost: 0
    };
    
    this.models = {
      'anthropic/claude-3-haiku': {
        cost: 0.00025,
        speed: 'fast',
        accuracy: 'high',
        specialty: 'general'
      },
      'openai/gpt-3.5-turbo': {
        cost: 0.002,
        speed: 'fast',
        accuracy: 'medium',
        specialty: 'chat'
      },
      'google/gemma-7b-it': {
        cost: 0.0001,
        speed: 'medium',
        accuracy: 'medium',
        specialty: 'instruct'
      },
      'meta-llama/llama-2-70b-chat': {
        cost: 0.0008,
        speed: 'slow',
        accuracy: 'high',
        specialty: 'reasoning'
      }
    };

    this.routingStrategies = {
      cost_optimized: this.selectCheapestModel.bind(this),
      performance_first: this.selectFastestModel.bind(this),
      accuracy_first: this.selectMostAccurateModel.bind(this),
      balanced: this.selectBalancedModel.bind(this),
      adaptive: this.selectAdaptiveModel.bind(this)
    };

    this.currentStrategy = 'balanced';
  }

  selectModel(requestType = 'general', strategy = null) {
    try {
      const selectedStrategy = strategy || this.currentStrategy;
      const routingFunction = this.routingStrategies[selectedStrategy];
      
      if (!routingFunction) {
        console.warn(`Unknown routing strategy: ${selectedStrategy}, using balanced`);
        return this.selectBalancedModel(requestType);
      }

      const selectedModel = routingFunction(requestType);
      
      // Update selection stats
      this.updateSelectionStats(selectedModel, selectedStrategy);
      
      return {
        model: selectedModel,
        strategy: selectedStrategy,
        metadata: this.models[selectedModel]
      };
    } catch (error) {
      console.error('Model selection failed:', error);
      return {
        model: 'openai/gpt-3.5-turbo',
        strategy: 'fallback',
        metadata: this.models['openai/gpt-3.5-turbo']
      };
    }
  }

  selectCheapestModel(requestType) {
    const sortedModels = Object.entries(this.models)
      .sort(([,a], [,b]) => a.cost - b.cost);
    
    return sortedModels[0][0];
  }

  selectFastestModel(requestType) {
    const fastModels = Object.entries(this.models)
      .filter(([,config]) => config.speed === 'fast');
    
    if (fastModels.length === 0) {
      return Object.keys(this.models)[0];
    }
    
    // Among fast models, prefer the most accurate
    const sortedFastModels = fastModels
      .sort(([,a], [,b]) => {
        const accuracyScore = { 'high': 3, 'medium': 2, 'low': 1 };
        return accuracyScore[b.accuracy] - accuracyScore[a.accuracy];
      });
    
    return sortedFastModels[0][0];
  }

  selectMostAccurateModel(requestType) {
    const sortedModels = Object.entries(this.models)
      .sort(([,a], [,b]) => {
        const accuracyScore = { 'high': 3, 'medium': 2, 'low': 1 };
        return accuracyScore[b.accuracy] - accuracyScore[a.accuracy];
      });
    
    return sortedModels[0][0];
  }

  selectBalancedModel(requestType) {
    // Score models based on cost, speed, and accuracy
    const scoredModels = Object.entries(this.models).map(([model, config]) => {
      let score = 0;
      
      // Cost score (lower cost = higher score)
      if (config.cost < 0.0005) score += 3;
      else if (config.cost < 0.001) score += 2;
      else score += 1;
      
      // Speed score
      if (config.speed === 'fast') score += 3;
      else if (config.speed === 'medium') score += 2;
      else score += 1;
      
      // Accuracy score
      if (config.accuracy === 'high') score += 3;
      else if (config.accuracy === 'medium') score += 2;
      else score += 1;
      
      return { model, score, config };
    });
    
    // Sort by score and return the highest scoring model
    scoredModels.sort((a, b) => b.score - a.score);
    return scoredModels[0].model;
  }

  selectAdaptiveModel(requestType) {
    // Use performance history to make intelligent decisions
    const modelPerformance = this.getModelPerformanceScores();
    
    if (Object.keys(modelPerformance).length === 0) {
      // No performance history, use balanced selection
      return this.selectBalancedModel(requestType);
    }
    
    // Select model with best performance score
    const bestModel = Object.entries(modelPerformance)
      .sort(([,a], [,b]) => b - a)[0][0];
    
    return bestModel;
  }

  getModelPerformanceScores() {
    const scores = {};
    
    Object.keys(this.models).forEach(model => {
      const metrics = this.stats.performanceMetrics[model];
      if (!metrics) {
        scores[model] = 0;
        return;
      }
      
      // Calculate composite performance score
      const successRate = metrics.successful / (metrics.successful + metrics.failed);
      const speedScore = 1000 / (metrics.averageResponseTime || 1000); // Invert response time
      const costScore = 1 / (this.models[model].cost * 1000); // Invert cost
      
      scores[model] = (successRate * 0.5) + (speedScore * 0.3) + (costScore * 0.2);
    });
    
    return scores;
  }

  updateSelectionStats(model, strategy) {
    this.stats.totalRequests++;
    
    if (!this.stats.modelSelections[model]) {
      this.stats.modelSelections[model] = 0;
    }
    this.stats.modelSelections[model]++;
  }

  recordModelPerformance(model, responseTime, success, cost = 0) {
    try {
      if (!this.stats.performanceMetrics[model]) {
        this.stats.performanceMetrics[model] = {
          successful: 0,
          failed: 0,
          totalResponseTime: 0,
          averageResponseTime: 0,
          totalCost: 0
        };
      }
      
      const metrics = this.stats.performanceMetrics[model];
      
      if (success) {
        metrics.successful++;
      } else {
        metrics.failed++;
      }
      
      metrics.totalResponseTime += responseTime;
      const totalRequests = metrics.successful + metrics.failed;
      metrics.averageResponseTime = metrics.totalResponseTime / totalRequests;
      
      metrics.totalCost += cost;
      this.stats.totalCost += cost;
      
      // Update global average response time
      this.updateGlobalAverageResponseTime();
      
    } catch (error) {
      console.error('Failed to record model performance:', error);
    }
  }

  updateGlobalAverageResponseTime() {
    const allMetrics = Object.values(this.stats.performanceMetrics);
    if (allMetrics.length === 0) return;
    
    const totalTime = allMetrics.reduce((sum, metrics) => sum + metrics.totalResponseTime, 0);
    const totalRequests = allMetrics.reduce((sum, metrics) => sum + metrics.successful + metrics.failed, 0);
    
    this.stats.averageResponseTime = totalRequests > 0 ? totalTime / totalRequests : 0;
  }

  setRoutingStrategy(strategy) {
    if (this.routingStrategies[strategy]) {
      this.currentStrategy = strategy;
      console.log(`Routing strategy changed to: ${strategy}`);
      return true;
    } else {
      console.warn(`Invalid routing strategy: ${strategy}`);
      return false;
    }
  }

  getAvailableStrategies() {
    return Object.keys(this.routingStrategies);
  }

  getModelInfo(model) {
    return this.models[model] || null;
  }

  getAllModels() {
    return Object.keys(this.models);
  }

  getStats() {
    return {
      ...this.stats,
      currentStrategy: this.currentStrategy,
      availableModels: Object.keys(this.models).length,
      modelPerformanceScores: this.getModelPerformanceScores(),
      recommendations: this.getRecommendations()
    };
  }

  getRecommendations() {
    const recommendations = [];
    
    // Cost optimization recommendation
    const modelUsage = this.stats.modelSelections;
    const expensiveModelUsage = Object.entries(modelUsage)
      .filter(([model]) => this.models[model] && this.models[model].cost > 0.001)
      .reduce((sum, [, count]) => sum + count, 0);
    
    if (expensiveModelUsage > this.stats.totalRequests * 0.5) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Consider using cost_optimized strategy to reduce expenses',
        priority: 'medium'
      });
    }
    
    // Performance recommendation
    const avgResponseTime = this.stats.averageResponseTime;
    if (avgResponseTime > 5000) { // More than 5 seconds
      recommendations.push({
        type: 'performance',
        message: 'Average response time is high. Consider using performance_first strategy',
        priority: 'high'
      });
    }
    
    // Usage pattern recommendation
    if (this.stats.totalRequests > 100) {
      recommendations.push({
        type: 'strategy',
        message: 'You have enough usage data. Consider switching to adaptive strategy for optimal performance',
        priority: 'low'
      });
    }
    
    return recommendations;
  }

  // Get best model for specific use case
  getBestModelForUseCase(useCase) {
    const useCaseMapping = {
      'sentiment_analysis': this.selectBalancedModel('sentiment'),
      'text_generation': this.selectMostAccurateModel('generation'),
      'classification': this.selectFastestModel('classification'),
      'reasoning': () => 'meta-llama/llama-2-70b-chat',
      'chat': () => 'openai/gpt-3.5-turbo',
      'cost_sensitive': this.selectCheapestModel
    };
    
    const selector = useCaseMapping[useCase];
    if (typeof selector === 'function') {
      return selector();
    } else if (typeof selector === 'string') {
      return selector;
    } else {
      return this.selectBalancedModel(useCase);
    }
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      totalRequests: 0,
      modelSelections: {},
      performanceMetrics: {},
      averageResponseTime: 0,
      totalCost: 0
    };
    console.log('Model router statistics reset');
  }

  // Export configuration
  exportConfig() {
    return {
      models: this.models,
      currentStrategy: this.currentStrategy,
      stats: this.stats,
      timestamp: new Date().toISOString()
    };
  }

  // Import configuration
  importConfig(config) {
    try {
      if (config.models) {
        this.models = { ...this.models, ...config.models };
      }
      if (config.currentStrategy && this.routingStrategies[config.currentStrategy]) {
        this.currentStrategy = config.currentStrategy;
      }
      if (config.stats) {
        this.stats = { ...this.stats, ...config.stats };
      }
      console.log('Model router configuration imported successfully');
      return true;
    } catch (error) {
      console.error('Failed to import configuration:', error);
      return false;
    }
  }
}

module.exports = ModelRouter;
