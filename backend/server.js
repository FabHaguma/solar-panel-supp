import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  openDatabase, records, shopFields, modelFields, stockOptions, programmingOptions,
  defaultOptions, ownerOptions, entryOptions, componentCategories, componentAvailability,
  priceBases, componentFields, componentCheckFields, schemaVersion,
} from './db.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const username = process.env.SOLPAN_USER;
const password = process.env.SOLPAN_PASSWORD;
const production = process.env.NODE_ENV === 'production';
const publicOrigin = process.env.SOLPAN_ORIGIN;
if (Boolean(username) !== Boolean(password) || (username && (username.includes(':') || !password.trim()))) {
  throw new Error('Set a valid SOLPAN_USER and SOLPAN_PASSWORD together.');
}
if ((production || host !== '127.0.0.1') && !username) {
  throw new Error('Set SOLPAN_USER and SOLPAN_PASSWORD before exposing the app.');
}
if (production && (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) {
  throw new Error('Set SOLPAN_ORIGIN to the public HTTPS origin.');
}

const db = openDatabase(resolve(process.env.DB_PATH || 'data/solpan.sqlite'));
const shops = records(db, 'shops', shopFields);
const models = records(db, 'models', modelFields);
const components = records(db, 'components', componentFields);
const componentChecks = records(db, 'component_checks', componentCheckFields);
const collections = {
  shops: { store: shops, fields: shopFields },
  models: { store: models, fields: modelFields },
  components: { store: components, fields: componentFields },
  'component-checks': { store: componentChecks, fields: componentCheckFields },
};
const routes = [
  ['/', 'index.html', 'text/html'],
  ['/assets/css/styles.css', 'assets/css/styles.css', 'text/css'],
  ['/assets/js/main.js', 'assets/js/main.js', 'text/javascript'],
  ['/assets/js/directory-filters.js', 'assets/js/directory-filters.js', 'text/javascript'],
];
const assets = new Map(routes.map(([route, file, type]) => {
  const path = new URL('../frontend/' + file, import.meta.url);
  return [route, { path, type, content: production ? readFileSync(path) : null }];
}));
const options = {
  stockOptions, programmingOptions, defaultOptions, ownerOptions, entryOptions,
  componentCategories, componentAvailability, priceBases,
};
const hash = value => createHash('sha256').update(value).digest();
const expectedAuth = username && hash(username + ':' + password);
const failures = new Map();

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function directory() {
  return {
    shops: shops.all(), models: models.all(),
    components: components.all(), componentChecks: componentChecks.all(),
  };
}

function exportDirectory(res) {
  db.exec('BEGIN');
  let snapshot;
  try {
    snapshot = directory();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const exportedAt = new Date().toISOString();
  res.setHeader('Content-Disposition', 'attachment; filename="solar-supplier-checks-' + exportedAt.slice(0, 10) + '.json"');
  json(res, 200, { schemaVersion, exportedAt, currency: 'RWF', ...snapshot });
}

function authorized(req, res) {
  if (!expectedAuth) return true;
  const value = req.headers.authorization || '';
  if (/^Basic [A-Za-z0-9+/]+=*$/i.test(value) &&
      timingSafeEqual(hash(Buffer.from(value.slice(6), 'base64')), expectedAuth)) return true;

  const forwarded = production && req.headers['x-forwarded-for'];
  const address = forwarded ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
  const now = Date.now();
  let attempts = failures.get(address);
  if (!attempts || attempts.until <= now) {
    if (failures.size >= 512) {
      for (const [key, row] of failures) if (row.until <= now) failures.delete(key);
      if (failures.size >= 512) failures.delete(failures.keys().next().value);
    }
    attempts = { count: 0, until: now + 60_000 };
    failures.set(address, attempts);
  }
  if (++attempts.count > 20) {
    res.setHeader('Retry-After', '60');
    json(res, 429, { error: 'Too many sign-in attempts. Try again in a minute.' });
    return false;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Solar supplier checks", charset="UTF-8"');
  json(res, 401, { error: 'Sign in with your app credentials.' });
  return false;
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function requestBody(req) {
  const origin = req.headers.origin;
  if ((origin && origin !== (publicOrigin || 'http://' + req.headers.host)) || req.headers['sec-fetch-site'] === 'cross-site') {
    req.resume();
    throw new RequestError(403, 'This request came from a different website.');
  }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume();
    throw new RequestError(415, 'Send data as JSON.');
  }
  const limit = 24 * 1024;
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new RequestError(413, 'This save is too large.');
  }
  return new Promise((accept, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length <= limit) chunks.push(chunk);
      else reject(new RequestError(413, 'This save is too large.'));
    });
    req.on('error', reject);
    req.on('end', () => {
      if (length > limit) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        accept(body);
      } catch {
        reject(new RequestError(400, 'Send a JSON object.'));
      }
    });
  });
}

const labels = {
  name: 'Shop / branch', listing: 'Model or listing', shop_id: 'Shop',
  watts: 'Wattage', max_watts: 'Maximum wattage', price_rwf: 'Price',
  visited_on: 'Visit date', checked_on: 'Check date', owner_status: 'Owner contact status',
  stock_status: 'Stock check', programmable: 'Programmable',
  programmable_by_default: 'Programmable by default', entry_source: 'Entry source',
  component_id: 'Component', amount_rwf: 'Quoted price', budget_min_rwf: 'Planned minimum',
  budget_max_rwf: 'Planned maximum',
  latitude: 'Latitude', longitude: 'Longitude',
};
const idRange = [1, Number.MAX_SAFE_INTEGER];
const priceRange = [0, 1e12];
const coordinates = { latitude: 90, longitude: 180 };
const numeric = {
  shop_id: idRange, component_id: idRange, watts: [1, 100000], max_watts: [1, 100000],
  price_rwf: priceRange, amount_rwf: priceRange, budget_min_rwf: priceRange, budget_max_rwf: priceRange,
};
const enumFields = {
  owner_status: ownerOptions, stock_status: stockOptions, entry_source: entryOptions,
  programmable: programmingOptions, programmable_by_default: defaultOptions,
  category: componentCategories, availability: componentAvailability, price_basis: priceBases,
};
const defaults = { owner_status: 'Not asked', stock_status: 'Not checked', entry_source: 'Shop visit' };

function clean(field, raw) {
  const label = labels[field] || field.replaceAll('_', ' ');
  const fallback = defaults[field] || null;
  if (raw == null || raw === '') return fallback;
  if (Object.hasOwn(coordinates, field)) {
    if (!Number.isFinite(raw) || Math.abs(raw) > coordinates[field]) {
      throw new RequestError(400, label + ' is outside the allowed range.');
    }
    return raw;
  }
  if (Object.hasOwn(numeric, field)) {
    const [minimum, maximum] = numeric[field];
    if (!Number.isSafeInteger(raw) || raw < minimum || raw > maximum) {
      throw new RequestError(400, label + ' must be a valid whole number.');
    }
    return raw;
  }
  if (typeof raw !== 'string') throw new RequestError(400, label + ' must be text.');
  const value = raw.trim();
  if (!value) return fallback;
  const longText = field.endsWith('_url') || field.endsWith('notes') ||
    ['questions', 'offering', 'description', 'vendor_leads'].includes(field);
  if (value.length > (longText ? 2000 : 300)) throw new RequestError(400, label + ' is too long.');
  if (Object.hasOwn(enumFields, field) && !enumFields[field].includes(value)) {
    throw new RequestError(400, 'Choose a valid ' + label.toLowerCase() + '.');
  }
  if (field.endsWith('_url')) {
    const url = URL.canParse(value) && new URL(value);
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new RequestError(400, label + ' must be an HTTP or HTTPS link.');
    }
  }
  if (field.endsWith('_on') && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
    throw new RequestError(400, label + ' must be a valid date.');
  }
  if ((field === 'email' || field === 'owner_email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new RequestError(400, 'Enter a valid email address.');
  }
  return value;
}

function validate(type, data, previous) {
  const { fields } = collections[type];
  const row = Object.fromEntries(fields.map(field => [
    field, clean(field, Object.hasOwn(data, field) ? data[field] : previous?.[field]),
  ]));
  if (type === 'shops') {
    if (!row.name) throw new RequestError(400, 'Enter the shop or branch name.');
    if ((row.latitude == null) !== (row.longitude == null)) {
      throw new RequestError(400, 'Enter latitude and longitude together.');
    }
    if (row.latitude !== (previous?.latitude ?? null) || row.longitude !== (previous?.longitude ?? null)) {
      row.pin_note = row.latitude == null ? null : 'Pin entered in the app.';
      row.pin_source_url = null;
    }
    if (row.owner_status === 'Contact obtained' && !row.owner_phone && !row.owner_email) {
      throw new RequestError(400, 'Add a business phone or email for the owner or decision-maker first.');
    }
  } else if (type === 'models') {
    if (!row.listing) throw new RequestError(400, 'Enter the panel model or description.');
    if (!row.shop_id || !shops.get(row.shop_id)) throw new RequestError(400, 'Choose an existing shop.');
    if (row.max_watts && (!row.watts || row.max_watts < row.watts)) {
      throw new RequestError(400, 'Maximum wattage must be at least the starting wattage.');
    }
    if (['Yes', 'No'].includes(row.programmable_by_default) && row.programmable !== 'Yes') {
      throw new RequestError(400, 'Set Programmable to Yes before recording whether settings are adjustable as sold.');
    }
    if (row.programmable === 'Yes' && row.programmable_by_default === 'N/A') {
      throw new RequestError(400, 'Choose Yes, No or Unknown for Programmable by default.');
    }
  } else if (type === 'components') {
    if (!row.name || !row.category) throw new RequestError(400, 'Enter a component name and category.');
    if (row.budget_min_rwf != null && row.budget_max_rwf != null && row.budget_min_rwf > row.budget_max_rwf) {
      throw new RequestError(400, 'Planned maximum must be at least the planned minimum.');
    }
  } else {
    if (!row.component_id || !components.get(row.component_id)) throw new RequestError(400, 'Choose an existing component.');
    if (row.shop_id != null) {
      const shop = shops.get(row.shop_id);
      if (!shop) throw new RequestError(400, 'Choose an existing shop.');
      row.vendor = shop.name;
    }
    if (!row.vendor || !row.availability || !row.checked_on) {
      throw new RequestError(400, 'Enter a vendor, availability and check date.');
    }
    if (row.amount_rwf != null && !row.price_basis) throw new RequestError(400, 'Choose how the price was quoted.');
    if (row.amount_rwf == null) row.price_basis = null;
  }
  return row;
}

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method === 'GET' && req.url === '/healthz') {
    db.prepare('SELECT 1 FROM shops LIMIT 1').get();
    return json(res, 200, { ok: true });
  }
  if (!authorized(req, res)) {
    req.resume();
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && pathname === '/api/v1/directory') {
    return json(res, 200, { ...directory(), options });
  }
  if (req.method === 'GET' && pathname === '/api/v1/export') return exportDirectory(res);
  const match = /^\/api\/v1\/(shops|models|components|component-checks)(?:\/([1-9]\d*))?$/.exec(pathname);
  if (match && ((req.method === 'POST' && !match[2]) || (req.method === 'PUT' && match[2]))) {
    const [, type, rawId] = match;
    const { store } = collections[type];
    const id = rawId ? Number(rawId) : null;
    const previous = Number.isSafeInteger(id) ? store.get(id) : null;
    if (rawId && !previous) throw new RequestError(404, 'This record was not found.');
    const body = await requestBody(req);
    const conflict = 'Someone updated this record. Close the form, refresh and reopen it.';
    if (previous && body.version !== previous.version) throw new RequestError(409, conflict);
    const row = validate(type, body, previous);
    const saved = previous ? store.update(id, body.version, row) : store.insert(row);
    if (!saved) throw new RequestError(409, conflict);
    return json(res, previous ? 200 : 201, saved);
  }
  const asset = assets.get(pathname);
  if (asset && ['GET', 'HEAD'].includes(req.method)) {
    const content = req.method === 'HEAD' ? undefined : asset.content ?? readFileSync(asset.path);
    res.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' });
    return res.end(content);
  }
  json(res, 404, { error: 'This page was not found.' });
}

const server = createServer({ requestTimeout: 15_000 }, (req, res) => {
  handle(req, res).catch(error => {
    if (error instanceof RequestError) return json(res, error.status, { error: error.message });
    console.error(error);
    json(res, 500, { error: 'Could not complete the request. Try again.' });
  });
});
server.listen(port, host, () => console.log('Solar supplier checks on http://' + host + ':' + server.address().port));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => db.close()));
}
