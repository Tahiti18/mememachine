// /services/aiEnsemble.js
// Production AI ensemble (OpenRouter) — no placeholders.

require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY) {
  console.error('❌ Missing OPENROUTER_API_KEY');
}

const PRIMARY_MODEL   = process.env.PRIMARY_MODEL   || 'anthropic/claude-3.5-sonnet';
const SECONDARY_MODEL = process.env.SECONDARY_MODEL || 'anthropic/claude-3-haiku';
const PREMIUM_MODEL   = process.env.PREMIUM_MODEL   || 'openai/gpt-4o-mini';
const BACKUP_MODEL    = process.env.BACKUP_MODEL    || 'qwen/qwen-2.5-72b-instruct';

const ENSEMBLE_MODE   = (process.env.AI_ENSEMBLE_MODE || 'adaptive').toLowerCase(); // adaptive|weighted|primary_only
const ENSEMBLE_VOTING = (process.env.ENSEMBLE_VOTING || 'weighted').toLowerCase();  // weighted|majority
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85');

const headers = {
  'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
  'HTTP-Referer': 'https://memesmachine.netlify.app',
  'X-Title': 'MemesMachine',
  'Content-Type': 'application/json',
};

async function callOpenRouter(model, system, user) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user }
    ],
    temperature: 0.3,
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${model} ${res.status}: ${txt.slice(0, 400)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || '';
  return content.trim();
}

function toSentimentScore(text) {
  // Extract a 0–100 score if present; otherwise simple heuristic fallback.
  const m = text.match(/(\b\d{1,3})\s*\/\s*100|\b(\d{1,3})\s*%|\bscore\s*[:=]\s*(\d{1,3})/i);
  const n = parseInt(m?.[1] || m?.[2] || m?.[3] || '', 10);
  if (!isNaN(n)) return Math.max(0, Math.min(100, n));

  // Fallback: crude polarity guess to keep it deterministic
  const pos = (text.match(/\b(bullish|positive|good|buy|pump|moon)\b/gi) || []).length;
  const neg = (text.match(/\b(bearish|negative|bad|sell|dump)\b/gi) || []).length;
  if (pos === 0 && neg === 0) return 50;
  const score = 50 + (pos - neg) * 10;
  return Math.max(0, Math.min(100, score));
}

function vote(scores) {
  if (!scores.length) return 50;

  if (ENSEMBLE_VOTING === 'majority') {
    const highs = scores.filter(s => s >= 60).length;
    const lows  = scores.filter(s => s <= 40).length;
    if (highs > lows) return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    if (lows > highs)  return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    return 50;
  }

  // weighted (default): premium > primary > secondary > backup
  const weight = m => (m === PREMIUM_MODEL ? 1.5 : m === PRIMARY_MODEL ? 1.2 : m === SECONDARY_MODEL ? 1.0 : 0.9);
  const totalW = scores.reduce((acc, s) => acc + weight(s.model), 0);
  const wAvg   = scores.reduce((acc, s) => acc + s.value * weight(s.model), 0) / (totalW || 1);
  return Math.round(wAvg);
}

async function analyzeSentiment(content) {
  const system = 'You are a crypto market sentiment rater. Return ONLY a concise explanation and a numeric score 0-100 (0 very negative, 100 very positive).';
  const prompt = `Text:\n"""${content}"""\n\nReturn a JSON object with keys: explanation, score (0-100).`;

  const models = ENSEMBLE_MODE === 'primary_only'
    ? [PRIMARY_MODEL]
    : [PRIMARY_MODEL, SECONDARY_MODEL, PREMIUM_MODEL, BACKUP_MODEL];

  const results = [];
  for (const model of models) {
    try {
      const out = await callOpenRouter(model, system, prompt);
      // try to parse JSON first
      let explanation = out;
      let score;
      try {
        const j = JSON.parse(out);
        explanation = j.explanation || out;
        score = parseInt(j.score, 10);
      } catch {
        score = toSentimentScore(out);
      }
      results.push({ model, value: score, raw: out, explanation });
    } catch (e) {
      console.warn(`⚠️ ${model} sentiment failed: ${e.message}`);
    }
  }

  if (!results.length) throw new Error('All models failed for sentiment');

  const finalScore = vote(results);
  const confidence = Math.min(
    0.99,
    1 - (results.map(r => Math.abs(r.value - finalScore)).reduce((a,b)=>a+b,0) / (results.length * 100))
  );

  return {
    score: finalScore,
    confidence: parseFloat(confidence.toFixed(3)),
    details: results.map(r => ({ model: r.model, score: r.value })),
    explanation: results.find(r => r.model === PRIMARY_MODEL)?.explanation || results[0].explanation
  };
}

async function generalAnalyze(content) {
  const system = 'You are an expert crypto researcher. Provide a concise risk/impact summary. Keep it under 120 words.';
  const out = await callOpenRouter(PRIMARY_MODEL, system, content);
  return out;
}

function status() {
  return {
    ok: !!OPENROUTER_API_KEY,
    mode: ENSEMBLE_MODE,
    voting: ENSEMBLE_VOTING,
    threshold: CONFIDENCE_THRESHOLD,
    models: {
      primary: PRIMARY_MODEL,
      secondary: SECONDARY_MODEL,
      premium: PREMIUM_MODEL,
      backup: BACKUP_MODEL
    }
  };
}

module.exports = {
  analyzeSentiment,
  generalAnalyze,
  status,
};
