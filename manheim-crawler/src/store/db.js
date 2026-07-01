// src/store/db.js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS manheim (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  plan_type TEXT,
  year TEXT, make TEXT, model TEXT, body_type TEXT, colour TEXT, variant TEXT,
  doors TEXT, seats TEXT, odometer TEXT, transmission TEXT, engine TEXT,
  fuel_type TEXT, registration TEXT, vin TEXT, no_of_keys TEXT, seller_type TEXT,
  comment TEXT, damage TEXT,
  source_url TEXT,
  fetch_mode TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manheim_vin ON manheim(vin);
CREATE INDEX IF NOT EXISTS idx_manheim_rego ON manheim(registration);

CREATE TABLE IF NOT EXISTS manheim_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manheim_id INTEGER,
  uuid TEXT,
  url TEXT,
  s3_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_manheim ON manheim_image(manheim_id);

CREATE TABLE IF NOT EXISTS failed_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  kind TEXT,
  error TEXT,
  attempts INTEGER,
  ts TEXT DEFAULT (datetime('now'))
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
