import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const stockOptions = ['Not checked', 'In stock', 'Can order', 'Unavailable', 'Different model', 'Unknown'];
export const programmingOptions = ['Yes', 'No', 'N/A (panel only)', 'Unknown'];
export const defaultOptions = ['Yes', 'No', 'N/A', 'Unknown'];
export const ownerOptions = ['Not asked', 'Asked', 'Contact obtained', 'Follow up', 'Unavailable'];
export const entryOptions = ['Online listing', 'Catalogue / other source', 'Classified ad', 'Shop visit'];

export const shopFields = [
  'name', 'location', 'phone', 'other_phone', 'email', 'map_url', 'offering', 'questions',
  'public_contact', 'public_contact_phone', 'shop_url', 'contact_url', 'offering_url',
  'owner_name', 'owner_role', 'owner_phone', 'owner_email', 'owner_status', 'owner_notes',
  'visited_on', 'visit_notes',
];
export const modelFields = [
  'shop_id', 'listing', 'brand', 'watts', 'max_watts', 'price_rwf', 'online_status',
  'source_notes', 'listing_url', 'datasheet_url', 'entry_source', 'stock_status', 'checked_on',
  'confirmed_code', 'programmable', 'programmable_by_default', 'device', 'visit_notes',
];

const schema = `
  CREATE TABLE shops (
    id INTEGER PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL, location TEXT, phone TEXT, other_phone TEXT, email TEXT,
    map_url TEXT, offering TEXT, questions TEXT, public_contact TEXT, public_contact_phone TEXT,
    shop_url TEXT, contact_url TEXT, offering_url TEXT, owner_name TEXT, owner_role TEXT,
    owner_phone TEXT, owner_email TEXT, owner_status TEXT NOT NULL DEFAULT 'Not asked',
    owner_notes TEXT, visited_on TEXT, visit_notes TEXT
  );
  CREATE TABLE models (
    id INTEGER PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE RESTRICT, listing TEXT NOT NULL,
    brand TEXT, watts INTEGER, max_watts INTEGER, price_rwf INTEGER, online_status TEXT,
    source_notes TEXT, listing_url TEXT, datasheet_url TEXT, entry_source TEXT NOT NULL DEFAULT 'Shop visit',
    stock_status TEXT NOT NULL DEFAULT 'Not checked', checked_on TEXT,
    confirmed_code TEXT, programmable TEXT, programmable_by_default TEXT, device TEXT, visit_notes TEXT
  );
  CREATE INDEX models_shop ON models(shop_id, id);
`;

const insertSql = (table, fields) =>
  `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
const values = (row, fields) => fields.map(field => row[field] ?? null);

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    if (version > 1) throw new Error('This database was created with a newer release.');
    if (version === 0) {
      db.exec(schema);
      const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));
      const addShop = db.prepare(insertSql('shops', ['id', ...shopFields]));
      const addModel = db.prepare(insertSql('models', modelFields));
      for (const shop of seed.shops) addShop.run(...values(shop, ['id', ...shopFields]));
      for (const model of seed.models) addModel.run(...values(model, modelFields));
      db.exec('PRAGMA user_version = 1;');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

export function records(db, table, fields) {
  const all = db.prepare(`SELECT * FROM ${table} ORDER BY id`);
  const get = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const insert = db.prepare(insertSql(table, fields));
  const update = db.prepare(`
    UPDATE ${table} SET ${fields.map(field => field + ' = ?').join(', ')}, version = version + 1
    WHERE id = ? AND version = ?
  `);
  return {
    all: () => all.all(),
    get: id => get.get(id),
    insert(row) {
      return get.get(insert.run(...values(row, fields)).lastInsertRowid);
    },
    update(id, version, row) {
      if (!update.run(...values(row, fields), id, version).changes) return null;
      return get.get(id);
    },
  };
}
