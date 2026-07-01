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
CREATE UNIQUE INDEX IF NOT EXISTS uniq_image ON manheim_image(manheim_id, url);

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

const COLS = [
  'uuid','plan_type','year','make','model','body_type','colour','variant',
  'doors','seats','odometer','transmission','engine','fuel_type',
  'registration','vin','no_of_keys','seller_type','comment','damage',
  'source_url','fetch_mode',
];

function findExisting(db, v) {
  if (v.vin) {
    const byVin = db.prepare('SELECT * FROM manheim WHERE vin = ?').get(v.vin);
    if (byVin) return byVin;
  }
  if (v.registration) {
    const byRego = db.prepare('SELECT * FROM manheim WHERE registration = ?').get(v.registration);
    if (byRego) {
      // both present but existing row's vin differs from incoming vin → conflict
      if (v.vin && byRego.vin && byRego.vin !== v.vin) return null;
      return byRego;
    }
  }
  return null;
}

export function upsertVehicle(db, v) {
  const existing = findExisting(db, v);

  // 冲突检测：incoming 有 vin，且按 rego 找到一行但 vin 不同（existing 为 null 表示走新增）
  if (v.vin && v.registration) {
    const byRego = db.prepare('SELECT vin FROM manheim WHERE registration = ?').get(v.registration);
    if (byRego && byRego.vin && byRego.vin !== v.vin) {
      recordFailed(db, {
        url: v.source_url, kind: 'field_conflict',
        error: `rego ${v.registration} maps to vin ${byRego.vin} but incoming vin ${v.vin}`,
        attempts: 0,
      });
    }
  }

  // 只取 COLS 中"已定义且非 null"的列构造参数对象。
  // 关键：绑定的具名参数必须与 SQL 中出现的 @col 完全一致——
  // better-sqlite3 对"多余/undefined 的具名参数"会抛 RangeError，
  // 所以不能直接 .run(v)（v 上可能带未被 SQL 引用的键）。
  const cols = COLS.filter((c) => v[c] !== undefined && v[c] !== null);
  const params = {};
  for (const c of cols) params[c] = v[c];

  if (existing) {
    const sets = cols.map((c) => `${c} = @${c}`).concat("last_seen = datetime('now')");
    db.prepare(`UPDATE manheim SET ${sets.join(', ')} WHERE id = @id`)
      .run({ ...params, id: existing.id });
    return { id: existing.id, isNew: false };
  }

  const info = db.prepare(
    `INSERT INTO manheim (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`
  ).run(params);
  return { id: Number(info.lastInsertRowid), isNew: true };
}

export function recordFailed(db, { url, kind, error, attempts }) {
  db.prepare('INSERT INTO failed_requests (url, kind, error, attempts) VALUES (?,?,?,?)')
    .run(url, kind, error, attempts ?? 0);
}

export function insertImages(db, manheimId, uuid, images) {
  const stmt = db.prepare(
    `INSERT INTO manheim_image (manheim_id, uuid, url, s3_url)
     VALUES (?,?,?,?)
     ON CONFLICT(manheim_id, url) DO UPDATE SET s3_url = COALESCE(excluded.s3_url, s3_url)`
  );
  const tx = db.transaction((rows) => {
    for (const img of rows) stmt.run(manheimId, uuid, img.url, img.s3_url ?? null);
  });
  tx(images);
}
