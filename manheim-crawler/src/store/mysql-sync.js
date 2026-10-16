// src/store/mysql-sync.js
import mysql from 'mysql2/promise';
import { ensureItemIdColumn } from './mysql-migrate.js';

const COLS = [
  'uuid', 'plan_type', 'year', 'make', 'body_type', 'model', 'colour', 'variant',
  'doors', 'seats', 'odometer', 'transmission', 'engine', 'fuel_type',
  'registration', 'vin', 'no_of_keys', 'seller_type', 'damage', 'comment', 'item_id',
];

// SELECT-先查（vin OR rego OR item_id，命中即跳过）→ 不存在才插车+图片。
// 生产表无唯一键，去重靠这里的应用层查（见 spec §7）。命中即跳过、不 UPDATE（字段冻结在首次入库值）。
export async function syncRows(db, conn) {
  const rows = db.prepare('SELECT * FROM manheim').all();
  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const [ex] = await conn.execute(
      `SELECT id FROM car_crawler_manheim
       WHERE vin = ? OR registration = ? OR (item_id IS NOT NULL AND item_id = ?) LIMIT 1`,
      [row.vin, row.registration, row.item_id]
    );
    if (ex.length) { skipped++; continue; }

    const cols = COLS.filter((c) => row[c] != null);
    const sql = `INSERT INTO car_crawler_manheim (${cols.join(',')},create_by,update_by,create_time,update_time)
                 VALUES (${cols.map(() => '?').join(',')},'System','System',NOW(),NOW())`;
    const [ins] = await conn.execute(sql, cols.map((c) => row[c]));
    const carId = ins.insertId; // MySQL 自增 id —— 图片外键必须用它，不是 SQLite id

    const allImgs = db.prepare('SELECT url FROM manheim_image WHERE manheim_id = ? AND url IS NOT NULL').all(row.id);
    const imgs = allImgs.filter((im) => im.url.length <= 255); // MySQL url 列 varchar(255)
    if (imgs.length !== allImgs.length) {
      console.warn(`[sync] ${row.vin || row.item_id}: 丢弃 ${allImgs.length - imgs.length} 条 >255 字符的图片 URL（MySQL 列上限）`);
    }
    for (const im of imgs) {
      await conn.execute(
        `INSERT INTO car_crawler_manheim_image (uuid,manheim_id,url,create_by,update_by,create_time,update_time)
         VALUES (?,?,?,?,?,NOW(),NOW())`,
        [row.uuid, carId, im.url, 'System', 'System']
      );
    }
    inserted++;
  }
  return { inserted, skipped };
}

export async function syncToMysql(db, cfg) {
  if (!cfg.mysql.enabled) return { inserted: 0, skipped: 0, disabled: true };
  const conn = await mysql.createConnection({
    host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user,
    password: cfg.mysql.password, database: cfg.mysql.database,
  });
  try {
    await ensureItemIdColumn(conn, { dbName: cfg.mysql.database }); // 幂等，确保 item_id 列在
    return await syncRows(db, conn);
  } finally {
    await conn.end();
  }
}
