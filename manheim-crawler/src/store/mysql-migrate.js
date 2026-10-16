// src/store/mysql-migrate.js
// 幂等给生产表加 item_id 列。MySQL 无 ADD COLUMN IF NOT EXISTS，用 information_schema 判断。
export async function ensureItemIdColumn(conn, { dbName }) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'car_crawler_manheim' AND COLUMN_NAME = 'item_id'`,
    [dbName]
  );
  const added = cols.length === 0;
  if (added) {
    await conn.query('ALTER TABLE car_crawler_manheim ADD COLUMN item_id VARCHAR(50) NULL');
  }
  // 索引单独幂等：即便列已存在（可能上次加列后没建成索引）也补建，重复则忽略。
  try {
    await conn.query('CREATE INDEX idx_manheim_item ON car_crawler_manheim (item_id)');
  } catch (e) {
    if (!/Duplicate key name/i.test(String(e.message || e))) throw e;
  }
  return { added };
}
