const fs = require('fs');
const path = require('path');

// built-in defaults (ship with code)
const defaultMap = {
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

// persistent cache on disk (editable at runtime)
const CACHE_PATH = path.join(__dirname, '..', 'data', 'userIdCache.json');

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function saveCache(map) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(map, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save userIdCache.json:', e.message || e);
    return false;
  }
}

// Returns { id, source: 'cache'|'local-map'|'none' }
async function resolveHandleToIdWithSource(handleRaw) {
  const h = String(handleRaw).replace(/^@/, '').trim();
  if (!h) return { id: null, source: 'none' };

  const cache = loadCache();
  const fromCache = cache[h] || cache[h.toLowerCase()];
  if (fromCache) return { id: String(fromCache), source: 'cache' };

  const fromDefault = defaultMap[h] || defaultMap[h.toLowerCase()];
  if (fromDefault) return { id: String(fromDefault), source: 'local-map' };

  return { id: null, source: 'none' };
}

// Back-compat helper (string|null)
async function resolveHandleToId(handleRaw) {
  const { id } = await resolveHandleToIdWithSource(handleRaw);
  return id;
}

// Upsert mapping into cache
async function setHandleId(handleRaw, idRaw) {
  const h = String(handleRaw).replace(/^@/, '').trim();
  const id = String(idRaw).trim();
  if (!h || !/^\d+$/.test(id)) throw new Error('Invalid handle or id');

  const cache = loadCache();
  cache[h] = id;
  saveCache(cache);
  return { handle: h, id };
}

function listMappings() {
  const cache = loadCache();
  return {
    cache,
    defaults: defaultMap
  };
}

module.exports = {
  resolveHandleToId,
  resolveHandleToIdWithSource,
  setHandleId,
  listMappings
};
