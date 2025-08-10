// Enhanced index.js — MemesMachine API with Complete Integration
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

// ---------- Express setup ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cors());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests, slow down.' },
  })
);

const PORT = process.env.PORT || 8080;

// ---------- ENV & Config ----------
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const PRIORITY = (process.env.PRIORITY_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
const BASE = (process.env.TWITTER_ACCOUNTS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .filter(h => !PRIORITY.includes(h))
  .slice(0, Math.max(0, 5 - PRIORITY.length));

const PRIORITY_INTERVAL_MS = Math.max(60_000,  parseInt(process.env.PRIORITY_INTERVAL_MS || '60000', 10));
const BASE_INTERVAL_MS     = Math.max(600_000, parseInt(process.env.BASE_INTERVAL_MS || '600000', 10));
const PER_REQUEST_GAP_MS   = Math.max(10_000,  parseInt(process.env.PER_REQUEST_GAP_MS || '10000', 10));
const BURST_WINDOW_MS      = Math.max(300_000, parseInt(process.env.BURST_WINDOW_MS || '300000', 10));
const SUSPEND_COOLDOWN_MS  = Math.max(15*60_000, parseInt(process.env.SUSPEND_COOLDOWN_MS || '1800000', 10));
const DEBUG = /^true$/i.test(process.env.DEBUG_LOGS || 'false');

const AI_MODE              = process.env.AI_ENSEMBLE_MODE || 'adaptive';
const ENSEMBLE_VOTING      = process.env.ENSEMBLE_VOTING || 'weighted';
const CONFIDENCE_THRESHOLD = Math.min(1, Math.max(0, parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85')));
const MODEL_PRIMARY        = process.env.PRIMARY_MODEL   || 'deepseek/deepseek-r1';
const MODEL_SECONDARY      = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const MODEL_PREMIUM        = process.env.PREMIUM_MODEL   || 'anthropic/claude-3.5-sonnet';
const MODEL_BACKUP         = process.env.BACKUP_MODEL    || 'qwen/qwen-2.5-72b-instruct';

let CURRENT_MODE = (process.env.MODE_DEFAULT || 'simulation').toLowerCase();

// Enhanced Stats Tracking
const systemStats = {
  totalInvested: 0,
  tweetsAnalyzed: 0,
  tokensCreated: 0,
  successRate: 0,
  launchQueue: [],
  totalLaunches: 0,
  successfulLaunches: 0,
  totalCosts: 0,
  avgConfidence: 0,
  websitesGenerated: 0,
  activeTrades: 0
};

// Simulation envs
const SIM_ENABLED   = /^true$/i.test(process.env.SIMULATION_ENABLED || 'true');
const SIM_REAL      = /^true$/i.test(process.env.SIMULATION_USE_REAL_TWEETS || 'true');
const SIM_LOOKBACK  = Math.max(10, parseInt(process.env.SIMULATION_LOOKBACK_MINUTES || '120', 10));
const SIM_MAX_PER   = Math.max(1, parseInt(process.env.SIMULATION_MAX_TWEETS_PER_CYCLE || '4', 10));
const SIM_SPEED     = Math.max(0.1, parseFloat(process.env.SIMULATION_SPEED_MULTIPLIER || '1'));
const SIM_RANDOM    = /^true$/i.test(process.env.SIMULATION_RANDOMIZE_START || 'true');

// ---------- HTTP clients ----------
const twitterHttp = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': TWITTER_API_KEY },
  timeout: 12000,
});

const openrouterHttp = axios.create({
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY || 'missing'}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ---------- Monitor State ----------
const lastSeenByHandle = {};
const tweetsBuffer = [];
const MAX_TWEETS = 300;

let priorityTimer = null;
let baseTimer = null;
const burstTimers = new Map();
const burstUntil = {};
let suspendedUntil = 0;
let lastPollAtPriority = null;
let lastPollAtBase = null;
let isMonitoring = false;

// ---------- Simulation State ----------
let simTimer = null;
let simActive = false;
let simDataset = [];
let simIndex = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dlog = (...a) => { if (DEBUG) console.log('[DEBUG]', ...a); };

// ---------- Enhanced AI Analysis Functions ----------
async function openrouterChat(model, systemPrompt, userPrompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY missing');
  }
  const res = await openrouterHttp.post('/chat/completions', {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return res?.data?.choices?.[0]?.message?.content?.trim() || '';
}

async function analyzeForLaunch(text, author = 'unknown') {
  systemStats.tweetsAnalyzed++;
  
  try {
    const analysisPrompt = `
    Analyze this tweet for meme coin launch potential. Consider:
    - Viral potential and engagement likelihood
    - Crypto relevance and market impact
    - Author influence (${author})
    - Meme-ability and token name suggestions
    
    Return JSON with:
    {
      "confidence": 0.0-1.0,
      "shouldLaunch": boolean,
      "tokenSuggestion": {"name": "TokenName", "symbol": "SYMBOL"},
      "memeTheme": "ThemeDescription",
      "viralScore": 0.0-1.0,
      "reasoning": "Brief explanation"
    }
    `;
    
    const content = await openrouterChat(MODEL_PREMIUM, analysisPrompt, `Tweet: "${text}"`);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        confidence: 0.3,
        shouldLaunch: false,
        tokenSuggestion: { name: "Unknown", symbol: "UNK" },
        memeTheme: "Generic",
        viralScore: 0.3,
        reasoning: "Analysis failed"
      };
    }
    
    // Update running average
    if (systemStats.tweetsAnalyzed > 0) {
      systemStats.avgConfidence = (systemStats.avgConfidence * (systemStats.tweetsAnalyzed - 1) + parsed.confidence) / systemStats.tweetsAnalyzed;
    }
    
    return {
      ok: true,
      model: MODEL_PREMIUM,
      ...parsed,
      timestamp: new Date().toISOString(),
      author
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'analysis failed',
      confidence: 0,
      shouldLaunch: false
    };
  }
}

// ---------- Token Creation Functions ----------
async function createToken(tokenData, tweetData, testMode = true) {
  if (testMode) {
    // Simulate token creation
    await sleep(2000);
    systemStats.tokensCreated++;
    systemStats.totalLaunches++;
    
    const mockToken = {
      address: `0x${Math.random().toString(16).substr(2, 40)}`,
      name: tokenData.name,
      symbol: tokenData.symbol,
      supply: 1000000000,
      decimals: 18,
      created: new Date().toISOString(),
      cost: 0.1, // SOL
      status: 'deployed'
    };
    
    console.log(`🚀 [TEST MODE] Token created: ${mockToken.symbol} (${mockToken.address})`);
    return { ok: true, token: mockToken };
  }
  
  // TODO: Integrate with actual token-creator microservice
  // const response = await axios.post('http://token-creator:3003/api/create', tokenData);
  
  return { ok: false, error: 'Production token creation not implemented yet' };
}

async function generateWebsite(tokenData, memeTheme, testMode = true) {
  if (testMode) {
    await sleep(1500);
    systemStats.websitesGenerated++;
    
    const mockWebsite = {
      url: `https://${tokenData.symbol.toLowerCase()}-token.com`,
      status: 'deployed',
      template: memeTheme,
      created: new Date().toISOString()
    };
    
    console.log(`🌐 [TEST MODE] Website generated: ${mockWebsite.url}`);
    return { ok: true, website: mockWebsite };
  }
  
  // TODO: Integrate with actual website-generator microservice
  return { ok: false, error: 'Production website generation not implemented yet' };
}

async function setupTrading(tokenAddress, testMode = true) {
  if (testMode) {
    await sleep(1000);
    systemStats.activeTrades++;
    
    const mockTrading = {
      pair: `${tokenAddress}/SOL`,
      initialLiquidity: 1000,
      status: 'active',
      started: new Date().toISOString()
    };
    
    console.log(`💱 [TEST MODE] Trading setup: ${mockTrading.pair}`);
    return { ok: true, trading: mockTrading };
  }
  
  // TODO: Integrate with actual trading-agent microservice
  return { ok: false, error: 'Production trading setup not implemented yet' };
}

// ---------- Full Launch Pipeline ----------
async function executeLaunchPipeline(tweetData, analysisResult, testMode = true) {
  const launchId = Date.now().toString();
  
  try {
    // Add to launch queue
    systemStats.launchQueue.push({
      id: launchId,
      status: 'processing',
      tweet: tweetData,
      analysis: analysisResult,
      started: new Date().toISOString()
    });
    
    console.log(`🎯 Starting launch pipeline for: ${analysisResult.tokenSuggestion.name}`);
    
    // Step 1: Create Token
    const tokenResult = await createToken(analysisResult.tokenSuggestion, tweetData, testMode);
    if (!tokenResult.ok) {
      throw new Error(`Token creation failed: ${tokenResult.error}`);
    }
    
    // Step 2: Generate Website
    const websiteResult = await generateWebsite(
      tokenResult.token,
      analysisResult.memeTheme,
      testMode
    );
    
    // Step 3: Setup Trading
    const tradingResult = await setupTrading(tokenResult.token.address, testMode);
    
    // Update success metrics
    systemStats.successfulLaunches++;
    systemStats.successRate = systemStats.successfulLaunches / systemStats.totalLaunches;
    systemStats.totalCosts += tokenResult.token.cost || 0;
    
    // Remove from queue, mark as completed
    systemStats.launchQueue = systemStats.launchQueue.filter(q => q.id !== launchId);
    
    const result = {
      ok: true,
      launchId,
      token: tokenResult.token,
      website: websiteResult.website,
      trading: tradingResult.trading,
      confidence: analysisResult.confidence,
      completed: new Date().toISOString()
    };
    
    console.log(`✅ Launch completed: ${analysisResult.tokenSuggestion.symbol} - Confidence: ${(analysisResult.confidence * 100).toFixed(1)}%`);
    return result;
    
  } catch (error) {
    // Remove from queue, mark as failed
    systemStats.launchQueue = systemStats.launchQueue.filter(q => q.id !== launchId);
    
    console.error(`❌ Launch failed: ${error.message}`);
    return {
      ok: false,
      launchId,
      error: error.message,
      failed: new Date().toISOString()
    };
  }
}

// ---------- Tweet Processing Functions ----------
function normalizeTweets(raw, author) {
  return (raw || []).map(t => ({
    id: String(t.id ?? t.id_str ?? ''),
    text: t.text || '',
    created_at: t.createdAt || t.created_at || new Date().toISOString(),
    author,
    url: t.url || `https://x.com/${author}/status/${t.id}`,
  })).filter(t => t.id);
}

function pushTweets(list) {
  if (!Array.isArray(list) || !list.length) return;
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const t of list) {
    if (!tweetsBuffer.find(x => x.id === t.id)) {
      tweetsBuffer.unshift(t);
      
      // Auto-analyze high-priority tweets
      if (PRIORITY.includes(t.author) && CURRENT_MODE !== 'simulation') {
        analyzeForLaunch(t.text, t.author).then(analysis => {
          if (analysis.ok && analysis.shouldLaunch && analysis.confidence > CONFIDENCE_THRESHOLD) {
            console.log(`🚨 HIGH CONFIDENCE TWEET DETECTED: ${analysis.confidence.toFixed(2)} - ${analysis.tokenSuggestion.name}`);
            
            if (CURRENT_MODE === 'production') {
              executeLaunchPipeline(t, analysis, false);
            } else {
              executeLaunchPipeline(t, analysis, true);
            }
          }
        }).catch(e => console.error('Auto-analysis error:', e.message));
      }
    }
  }
  if (tweetsBuffer.length > MAX_TWEETS) tweetsBuffer.length = MAX_TWEETS;
}

// ---------- Core Twitter Fetch ----------
async function fetchLastTweets(handle) {
  try {
    const res = await twitterHttp.get('/twitter/user/last_tweets', {
      params: { userName: handle, includeReplies: false },
    });
    const tweets = normalizeTweets(res?.data?.tweets || [], handle);
    const since = lastSeenByHandle[handle];
    const fresh = since ? tweets.filter(t => t.id > since) : tweets;
    if (fresh.length) lastSeenByHandle[handle] = fresh[0].id;
    return fresh;
  } catch (e) {
    const st = e?.response?.status;
    if (st === 402) {
      suspendedUntil = Date.now() + SUSPEND_COOLDOWN_MS;
      console.warn(`⚠️ 402 for @${handle}. Suspending polling until ${new Date(suspendedUntil).toISOString()}`);
      return [];
    }
    if (st === 429) {
      console.warn(`⏳ 429 @${handle}. Backing off ${BASE_INTERVAL_MS}ms`);
      await sleep(BASE_INTERVAL_MS);
      return [];
    }
    if (st && st !== 404) {
      console.error(`❌ TwitterAPI.io ${st} for @${handle}: ${e?.message || 'error'}`);
    }
    return [];
  }
}

// ---------- Monitoring Functions (keeping existing logic) ----------
function ensureBurst(handle) {
  const now = Date.now();
  burstUntil[handle] = Math.max(burstUntil[handle] || 0, now + BURST_WINDOW_MS);
  if (burstTimers.has(handle)) return;

  const t = setInterval(async () => {
    if (Date.now() < suspendedUntil) return;
    if ((burstUntil[handle] || 0) <= Date.now()) {
      clearInterval(t);
      burstTimers.delete(handle);
      dlog(`Burst ended for @${handle}`);
      return;
    }
    const fresh = await fetchLastTweets(handle);
    if (fresh.length) {
      pushTweets(fresh);
      const first = fresh[0];
      console.log(`🆕 ${first.created_at} @${handle} — ${fresh.length} new. First: ${first.text.slice(0, 100)}`);
      burstUntil[handle] = Date.now() + BURST_WINDOW_MS;
    }
  }, Math.max(60_000, PRIORITY_INTERVAL_MS));

  burstTimers.set(handle, t);
  console.log(`⚡ Burst started for @${handle}`);
}

async function priorityLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtPriority = new Date().toISOString();
  for (let i = 0; i < PRIORITY.length; i++) {
    const h = PRIORITY[i];
    if (i) await sleep(PER_REQUEST_GAP_MS);
    const fresh = await fetchLastTweets(h);
    if (fresh.length) {
      pushTweets(fresh);
      console.log(`🟢 Priority @${h}: +${fresh.length}`);
      ensureBurst(h);
    }
  }
}

async function baseLoopOnce() {
  if (Date.now() < suspendedUntil) return;
  lastPollAtBase = new Date().toISOString();
  for (let i = 0; i < BASE.length; i++) {
    const h = BASE[i];
    if (i) await sleep(PER_REQUEST_GAP_MS);
    const fresh = await fetchLastTweets(h);
    if (fresh.length) {
      pushTweets(fresh);
      console.log(`🔵 Base @${h}: +${fresh.length}`);
      ensureBurst(h);
    }
  }
}

// ---------- Simulation Functions (keeping existing) ----------
async function buildSimulationDataset() {
  const handles = [...PRIORITY, ...BASE];
  const cutoff = Date.now() - SIM_LOOKBACK * 60_000;

  const collected = [];
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    if (!h) continue;
    if (i) await sleep(800);
    try {
      const res = await twitterHttp.get('/twitter/user/last_tweets', {
        params: { userName: h, includeReplies: false },
      });
      const arr = normalizeTweets(res?.data?.tweets || [], h)
        .filter(t => new Date(t.created_at).getTime() >= cutoff);
      collected.push(...arr);
      dlog(`SIM: fetched ${arr.length} from @${h}`);
    } catch (e) {
      console.warn(`SIM: fetch failed for @${h}:`, e?.response?.status || e?.message || e);
    }
  }

  collected.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return collected;
}

function simIntervalMs() {
  const base = Math.max(30_000, Math.min(PRIORITY_INTERVAL_MS, 120_000));
  return Math.max(10_000, Math.floor(base / SIM_SPEED));
}

async function startSimulation() {
  if (simActive) return { ok: true, message: 'simulation already running' };
  if (!SIM_ENABLED) return { ok: false, message: 'simulation disabled by env' };

  console.log(`🎛️ Simulation starting (lookback=${SIM_LOOKBACK}m, max/cycle=${SIM_MAX_PER}, speed=${SIM_SPEED}x)`);

  if (SIM_REAL) {
    simDataset = await buildSimulationDataset();
  } else {
    simDataset = [];
  }

  if (!simDataset.length) {
    console.warn('SIM: dataset is empty');
  }

  simIndex = SIM_RANDOM && simDataset.length ? Math.floor(Math.random() * simDataset.length) : 0;
  const tickMs = simIntervalMs();

  simTimer = setInterval(() => {
    if (!simDataset.length) return;
    const batch = [];
    for (let i = 0; i < SIM_MAX_PER; i++) {
      const t = simDataset[simIndex];
      if (!t) break;
      batch.push(t);
      simIndex = (simIndex + 1) % simDataset.length;
    }
    if (batch.length) {
      pushTweets(batch);
      console.log(`🎬 SIM replay: +${batch.length}`);
    }
  }, tickMs);

  simActive = true;
  return { ok: true, message: 'simulation started' };
}

function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  simActive = false;
  console.log('⏹️ Simulation stopped.');
  return { ok: true, message: 'simulation stopped' };
}

async function startMonitoring() {
  if (isMonitoring) return { ok: true, message: 'already running' };
  if (!TWITTER_API_KEY || (PRIORITY.length + BASE.length) === 0) {
    return { ok: false, message: 'Missing TWITTER_API_KEY or accounts' };
  }

  console.log(`🚀 Live monitoring started. Priority=[${PRIORITY.join(', ')||'none'}] Base=[${BASE.join(', ')||'none'}]`);

  isMonitoring = true;
  priorityLoopOnce().catch(e => console.error('Priority init error:', e?.message || e));
  baseLoopOnce().catch(e => console.error('Base init error:', e?.message || e));

  priorityTimer = setInterval(() => priorityLoopOnce().catch(e => console.error('Priority loop error:', e?.message || e)), PRIORITY_INTERVAL_MS);
  baseTimer = setInterval(() => baseLoopOnce().catch(e => console.error('Base loop error:', e?.message || e)), BASE_INTERVAL_MS);

  return { ok: true, message: 'started' };
}

function stopMonitoring() {
  if (priorityTimer) clearInterval(priorityTimer);
  if (baseTimer) clearInterval(baseTimer);
  for (const t of burstTimers.values()) clearInterval(t);
  burstTimers.clear();
  isMonitoring = false;
  console.log('🛑 Live monitoring stopped.');
  return { ok: true, message: 'stopped' };
}

// ---------- API Routes ----------
app.get('/', (_req, res) => res.send('MemesMachine Enhanced API online'));

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'online',
    monitoring: CURRENT_MODE === 'simulation' ? simActive : isMonitoring,
    apiHealth: {
      openrouter: !!OPENROUTER_API_KEY,
      database: true,
    },
    stats: {
      ...systemStats,
      successRate: systemStats.totalLaunches > 0 ? systemStats.successfulLaunches / systemStats.totalLaunches : 0
    },
    twitter: {
      priority: PRIORITY,
      base: BASE,
      suspended: Date.now() < suspendedUntil,
      suspendedUntil: Date.now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
      priorityIntervalMs: PRIORITY_INTERVAL_MS,
      baseIntervalMs: BASE_INTERVAL_MS,
      gapMs: PER_REQUEST_GAP_MS,
      burstWindowMs: BURST_WINDOW_MS,
    },
    ai: {
      mode: AI_MODE,
      voting: ENSEMBLE_VOTING,
      threshold: CONFIDENCE_THRESHOLD,
      models: {
        primary: MODEL_PRIMARY,
        secondary: MODEL_SECONDARY,
        premium: MODEL_PREMIUM,
        backup: MODEL_BACKUP,
      },
      hasOpenRouter: !!OPENROUTER_API_KEY,
    },
    launchPipeline: {
      queueLength: systemStats.launchQueue.length,
      processing: systemStats.launchQueue.filter(q => q.status === 'processing').length,
      avgConfidence: systemStats.avgConfidence.toFixed(3),
      totalCosts: systemStats.totalCosts.toFixed(3)
    },
    simulation: {
      enabled: SIM_ENABLED,
      active: simActive,
      lookbackMinutes: SIM_LOOKBACK,
      maxPerCycle: SIM_MAX_PER,
      speedMultiplier: SIM_SPEED,
      randomizeStart: SIM_RANDOM,
      datasetSize: simDataset.length,
      usesRealTweets: SIM_REAL,
      mode: CURRENT_MODE,
    },
  });
});

// Enhanced AI endpoints
app.get('/api/ai/ensemble', (_req, res) => {
  res.json({
    ok: true,
    mode: AI_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: MODEL_PRIMARY,
      secondary: MODEL_SECONDARY,
      premium: MODEL_PREMIUM,
      backup: MODEL_BACKUP,
    },
    hasOpenRouter: !!OPENROUTER_API_KEY,
  });
});

app.get('/api/ai/status', (_req, res) => {
  res.json({
    ok: true,
    mode: AI_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: MODEL_PRIMARY,
      secondary: MODEL_SECONDARY,
      premium: MODEL_PREMIUM,
      backup: MODEL_BACKUP,
    },
    hasOpenRouter: !!OPENROUTER_API_KEY,
  });
});

app.get('/api/ai/sentiment', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 2000);
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const content = await openrouterChat(
      MODEL_PRIMARY,
      'Return ONLY a JSON object with fields: score (0..100) and label in {POS, NEU, NEG}.',
      `Text: """${text}"""\nReturn JSON now.`
    );
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { score: 50, label: 'NEU' }; }
    res.json({ ok: true, ...parsed, model: MODEL_PRIMARY });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message || 'openrouter error' });
  }
});

app.get('/api/ai/analyze', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 3000);
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const content = await openrouterChat(
      MODEL_PREMIUM,
      'Summarize the text briefly and estimate a trading signal in {HIGH, MEDIUM, LOW}. Return JSON with: summary, signal, keywords (array).',
      `Text: """${text}"""\nReturn JSON only.`
    );
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      parsed = { summary: content.slice(0, 280), signal: 'LOW', keywords: [] };
    }
    res.json({ ok: true, model: MODEL_PREMIUM, ...parsed });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message || 'openrouter error' });
  }
});

// NEW: Enhanced AI analysis for launches
app.post('/api/ai/analyze-for-launch', async (req, res) => {
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  
  try {
    const result = await analyzeForLaunch(text, author);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// NEW: Token creation endpoints
app.post('/api/tokens/launch', async (req, res) => {
  const { tweetData, analysisResult, testMode = true } = req.body;
  
  if (!tweetData) {
    return res.status(400).json({ ok: false, error: 'tweetData required' });
  }
  
  try {
    // If no analysis provided, analyze the tweet
    let analysis = analysisResult;
    if (!analysis) {
      analysis = await analyzeForLaunch(tweetData.text, tweetData.author);
      if (!analysis.ok) {
        return res.status(400).json({ ok: false, error: 'Analysis failed', details: analysis.error });
      }
    }
    
    // Check confidence threshold
    if (analysis.confidence < CONFIDENCE_THRESHOLD) {
      return res.status(400).json({ 
        ok: false, 
        error: `Confidence too low: ${analysis.confidence} < ${CONFIDENCE_THRESHOLD}`,
        analysis 
      });
    }
    
    // Execute full launch pipeline
    const result = await executeLaunchPipeline(tweetData, analysis, testMode);
    res.json(result);
    
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/tokens/stats', (_req, res) => {
  res.json({
    ok: true,
    stats: {
      totalCreated: systemStats.tokensCreated,
      successRate: systemStats.successRate,
      avgConfidence: systemStats.avgConfidence,
      totalCosts: systemStats.totalCosts,
      queueLength: systemStats.launchQueue.length
    }
  });
});

// NEW: Website generation endpoints
app.post('/api/websites/generate', async (req, res) => {
  const { tokenData, memeTheme, testMode = true } = req.body;
  
  if (!tokenData) {
    return res.status(400).json({ ok: false, error: 'tokenData required' });
  }
  
  try {
    const result = await generateWebsite(tokenData, memeTheme || 'default', testMode);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// NEW: Trading endpoints
app.post('/api/trading/setup', async (req, res) => {
  const { tokenAddress, initialLiquidity = 1000, testMode = true } = req.body;
  
  if (!tokenAddress) {
    return res.status(400).json({ ok: false, error: 'tokenAddress required' });
  }
  
  try {
    const result = await setupTrading(tokenAddress, testMode);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/trading/stats', (_req, res) => {
  res.json({
    ok: true,
    stats: {
      activeTrades: systemStats.activeTrades,
      totalInvested: systemStats.totalInvested
    }
  });
});

// Existing Twitter/monitoring endpoints
app.get('/api/twitter/monitor', (_req, res) => {
  res.json({
    ok: true,
    monitoring: CURRENT_MODE === 'simulation' ? simActive : isMonitoring,
    priorityAccounts: PRIORITY,
    baseAccounts: BASE,
    totalTweets: tweetsBuffer.length,
    lastPollAtPriority,
    lastPollAtBase,
    priorityIntervalMs: PRIORITY_INTERVAL_MS,
    baseIntervalMs: BASE_INTERVAL_MS,
    gapMs: PER_REQUEST_GAP_MS,
    burstWindowMs: BURST_WINDOW_MS,
    suspended: Date.now() < suspendedUntil,
    suspendedUntil: Date.now() < suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
    recentActivity: tweetsBuffer.slice(0, 10),
    mode: CURRENT_MODE,
    simulation: { active: simActive, datasetSize: simDataset.length }
  });
});

app.get('/api/tweets/recent', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '20', 10), MAX_TWEETS));
  res.json({ tweets: tweetsBuffer.slice(0, limit) });
});

app.post('/api/monitor/start', async (_req, res) => {
  if (CURRENT_MODE === 'simulation') {
    const out = await startSimulation();
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } else {
    const out = await startMonitoring();
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  }
});

app.post('/api/monitor/stop', (_req, res) => {
  if (CURRENT_MODE === 'simulation') {
    return res.json(stopSimulation());
  } else {
    return res.json(stopMonitoring());
  }
});

app.get('/api/sim/status', (_req, res) => {
  res.json({ ok: true, active: simActive, datasetSize: simDataset.length, index: simIndex, mode: CURRENT_MODE });
});

app.post('/api/sim/start', async (_req, res) => res.json(await startSimulation()));
app.post('/api/sim/stop', (_req, res) => res.json(stopSimulation()));

app.post('/api/mode', (req, res) => {
  const mode = String((req.body && req.body.mode) || '').toLowerCase();
  if (!mode) return res.status(400).json({ ok: false, error: 'mode required' });
  if (!['simulation','production','paper_trading'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'invalid mode' });
  }
  
  if (simActive) stopSimulation();
  if (isMonitoring) stopMonitoring();
  CURRENT_MODE = mode;
  console.log(`🔀 Mode set to: ${CURRENT_MODE}`);
  res.json({ ok: true, mode: CURRENT_MODE });
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ MemesMachine Enhanced API listening on ${PORT}`);
  console.log(`• Auto-start monitoring: OFF (use POST /api/monitor/start)`);
  console.log(`• Default mode: ${CURRENT_MODE}`);
  console.log(`• Enhanced features: Token creation, Website generation, Trading automation`);
  if (!TWITTER_API_KEY) console.warn('⚠️ TWITTER_API_KEY is missing');
  if (!OPENROUTER_API_KEY) console.warn('⚠️ OPENROUTER_API_KEY is missing');
});
