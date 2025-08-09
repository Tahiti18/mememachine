// Hard-coded numeric IDs for your core influencer list.
// Returns an object { id, source } so logs can show "(local-map)" clearly.

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

async function resolveHandleToId(handleRaw) {
  const h = String(handleRaw).replace(/^@/, '').toLowerCase();
  const id = handleToIdMap[h] || null;
  return id ? { id, source: 'local-map' } : { id: null, source: 'none' };
}

module.exports = { resolveHandleToId };
