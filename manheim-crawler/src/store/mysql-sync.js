// src/store/mysql-sync.js
import mysql from 'mysql2/promise';

const MANHEIM_COLS = [
  'uuid','plan_type','year','make','model','body_type','colour','variant',
  'doors','seats','odometer','transmission','engine','fuel_type',
  'registration','vin','no_of_keys','seller_type','comment','damage',
];

// 用注入的 conn 写入（测试注入假 conn；生产用真实连接）
export async function syncRows(db, conn) {
  const rows = db.prepare('SELECT * FROM manheim').all();
  let n = 0;
  for (const row of rows) {
    const cols = MANHEIM_COLS.filter((c) => row[c] != null);
    const placeholders = cols.map(() => '?').join(',');
    const updates = cols.map((c) => `${c}=VALUES(${c})`).join(',');
    const sql = `INSERT INTO car_crawler_manheim (${cols.join(',')}) VALUES (${placeholders})
                 ON DUPLICATE KEY UPDATE ${updates}`;
    await conn.execute(sql, cols.map((c) => row[c]));
    n++;
  }
  return n;
}

export async function syncToMysql(db, cfg) {
  if (!cfg.mysql.enabled) return 0;
  const conn = await mysql.createConnection({
    host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user,
    password: cfg.mysql.password, database: cfg.mysql.database,
  });
  try {
    return await syncRows(db, conn);
  } finally {
    await conn.end();
  }
}
