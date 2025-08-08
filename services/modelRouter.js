class ModelRouter {
  constructor() {
    this.stats = {
      totalRequests: 0,
      modelSelections: {},
      performanceMetrics: {},
      averageResponseTime: 0
    };

    this.performanceHistory = {};
  }

  selectOptimalModel(context, availableModels) {
    const importance = this.assessContextImportance(context);
    const timeConstraints = this.getTimeConstraints(context);
    const costConstraints = this.getCostConstraints(context);

    console.log(`🧭 Routing decision: importance=${importance}, time=${timeConstraints}, cost=${costConstraints}`);

    // Route based on multiple factors
    if (importance === 'critical' && timeConstraints === 'urgent') {
      return this.selectHighPerformanceModel(availableModels);
    } else if (costConstraints === 'tight') {
      return this.selectCostEffectiveModel(availableModels);
    } else {
      return this.selectBalancedModel(availableModels);
    }
  }

  selectHighPerformanceModel(availableModels) {
    const highPerformanceModels = [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash-exp'
    ];

    return this.findBestAvailable(highPerformanceModels, availableModels);
  }

  selectCostEffectiveModel(availableModels) {
    const costEffectiveModels = [
      'deepseek/deepseek-r1',
      'qwen/qwen-2.5-72b-instruct',
      'mistral/mistral-7b-instruct'
    ];

    return this.findBestAvailable(costEffectiveModels, availableModels);
  }

  selectBalancedModel(availableModels) {
    const balancedModels = [
      'anthropic/claude-3-haiku',
      'google/gemini-2.0-flash-exp',
      'deepseek/deepseek-r1'
    ];

    return this.findBestAvailable(balancedModels, availableModels);
  }

  findBestAvailable(preferredModels, availableModels) {
    for (const model of preferredModels) {
      if (availableModels.includes(model)) {
        this.recordSelection(model);
        return model;
      }
    }

    // Fallback to first available
    const fallback = availableModels[0];
    this.recordSelection(fallback, 'fallback');
    return fallback;
  }

  assessContextImportance(context) {
    if (context.author === 'elonmusk' || 
        context.content?.toLowerCase().includes('breaking') ||
        context.metadata?.urgent === true) {
      return 'critical';
    }

    if (context.author === 'VitalikButerin' ||
        context.author === 'michael_saylor' ||
        this.isMarketHours()) {
      return 'high';
    }

    return 'normal';
  }

  getTimeConstraints(context) {
    const hour = new Date().getHours();
    const isMarketOpen = hour >= 9 && hour <= 16;

    if (context.metadata?.realtime === true || isMarketOpen) {
      return 'urgent';
    }

    return 'normal';
  }

  getCostConstraints(context) {
    if (context.metadata?.costSensitive === true) {
      return 'tight';
    }

    if (context.metadata?.premiumAnalysis === true) {
      return 'unlimited';
    }

    return 'balanced';
  }

  isMarketHours() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Monday-Friday, 9 AM - 4 PM EST
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 16;
  }

  recordSelection(model, reason = 'optimal') {
    this.stats.totalRequests++;
    this.stats.modelSelections[model] = (this.stats.modelSelections[model] || 0) + 1;

    console.log(`📊 Selected model: ${model} (${reason})`);
  }

  recordPerformance(model, metrics) {
    if (!this.performanceHistory[model]) {
      this.performanceHistory[model] = [];
    }

    this.performanceHistory[model].push({
      ...metrics,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 records per model
    if (this.performanceHistory[model].length > 100) {
      this.performanceHistory[model] = this.performanceHistory[model].slice(-100);
    }

    // Update average metrics
    this.updatePerformanceMetrics(model);
  }

  updatePerformanceMetrics(model) {
    const history = this.performanceHistory[model];
    if (!history || history.length === 0) return;

    const avgResponseTime = history.reduce((sum, record) => 
      sum + (record.responseTime || 0), 0) / history.length;

    const avgAccuracy = history.reduce((sum, record) => 
      sum + (record.accuracy || 0), 0) / history.length;

    this.stats.performanceMetrics[model] = {
      avgResponseTime,
      avgAccuracy,
      totalRequests: history.length,
      lastUpdated: new Date().toISOString()
    };
  }

  getModelRecommendation(context) {
    const availableModels = [
      'deepseek/deepseek-r1',
      'anthropic/claude-3-haiku',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash-exp',
      'qwen/qwen-2.5-72b-instruct'
    ];

    return {
      primary: this.selectOptimalModel(context, availableModels),
      fallback: this.selectCostEffectiveModel(availableModels),
      reasoning: this.getRoutingReasoning(context)
    };
  }

  getRoutingReasoning(context) {
    const importance = this.assessContextImportance(context);
    const time = this.getTimeConstraints(context);
    const cost = this.getCostConstraints(context);

    return {
      importance,
      timeConstraints: time,
      costConstraints: cost,
      isMarketHours: this.isMarketHours(),
      timestamp: new Date().toISOString()
    };
  }

  getStats() {
    return {
      ...this.stats,
      performanceHistory: Object.keys(this.performanceHistory).reduce((acc, model) => {
        acc[model] = this.performanceHistory[model].length;
        return acc;
      }, {})
    };
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      modelSelections: {},
      performanceMetrics: {},
      averageResponseTime: 0
    };
  }
}

module.exports = ModelRouter;
