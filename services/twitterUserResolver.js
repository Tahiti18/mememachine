// Hard-coded numeric IDs for your current influencer list.
// Source: stable, public IDs that don't change when handles change.

const handleToIdMap = {
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

// Returns: { id: string|null, source: 'local-map' }
async function resolveHandleToIdWithSource(handleRaw) {
  const h = String(handleRaw).replace(/^@/, '').toLowerCase();
  const id = handleToIdMap[h] || null;
  return { id, source: 'local-map' };
}

// Backward-compatible helper (string or null)
async function resolveHandleToId(handleRaw) {
  const { id } = await resolveHandleToIdWithSource(handleRaw);
  return id;
}

module.exports = { resolveHandleToId, resolveHandleToIdWithSource };
