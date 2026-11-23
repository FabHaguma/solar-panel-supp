export function vendorKey(name) {
  return (name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(?:ltd|limited)\b/g, '').trim().replace(/\s+/g, ' ');
}

export function shopKeys(shop) {
  return [shop.name, ...shop.name.split(' / ')].map(vendorKey);
}

export function leadNames(item) {
  return (item.vendor_leads || '').replace(/\([^)]*\)/g, '')
    .split(/\s+or\s+|[,;\n]/i)
    .map(name => name.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

const matchesLead = (keys, name) => keys.includes(name) ||
  (name.length >= 5 && keys.some(key => key.startsWith(name + ' ')));

export function findVendorMatch(filter, item, checks) {
  const keys = filter.shop ? shopKeys(filter.shop) : [vendorKey(filter.name)];
  const lead = leadNames(item).some(name => filter.shop
    ? matchesLead(keys, vendorKey(name))
    : keys.includes(vendorKey(name)));
  const matchingChecks = checks.filter(check => check.shop_id != null
    ? check.shop_id === filter.shop?.id
    : keys.includes(vendorKey(check.vendor)));
  return { lead, checks: matchingChecks };
}

export function vendorFilters(shops, items, checks) {
  const known = shops.flatMap(shopKeys);
  const other = new Map();
  for (const name of items.flatMap(leadNames)) {
    const key = vendorKey(name);
    if (key && !matchesLead(known, key) && !other.has(key)) other.set(key, name);
  }
  for (const check of checks) {
    const key = vendorKey(check.vendor);
    if (key && check.shop_id == null && !known.includes(key) && !other.has(key)) other.set(key, check.vendor);
  }
  const compare = (a, b) => a.name.localeCompare(b.name);
  return [
    shops.map(shop => ({ value: 'shop-' + shop.id, name: shop.name, shop })).sort(compare),
    [...other].map(([key, name]) => ({ value: 'vendor-' + key, name })).sort(compare),
  ];
}

export function hasCoordinates(place) {
  return Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude);
}

export function parseCoordinates(text) {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

export function distanceKm(origin, place) {
  const rad = Math.PI / 180;
  const lat = (place.latitude - origin.latitude) * rad;
  const lon = (place.longitude - origin.longitude) * rad;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(origin.latitude * rad) *
    Math.cos(place.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
