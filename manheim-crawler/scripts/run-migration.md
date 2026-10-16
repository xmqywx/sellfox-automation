# 生产库迁移记录：car_crawler_manheim 加 item_id 列

## 执行
- 时间：2026-10-16
- 库：`nzcar_recycling_prod`（AWS RDS）
- 脚本：`src/store/mysql-migrate.js` `ensureItemIdColumn()`
- 结果：`{ added: true }`（首次加列）

## before / after
- BEFORE：`item_id` 列不存在
- AFTER：
  - 列 `item_id varchar(50) NULL`（Key=MUL）
  - 索引 `idx_manheim_item`（1 条）

## 变更内容（纯加列 + 索引，不动现有数据）
```sql
ALTER TABLE car_crawler_manheim ADD COLUMN item_id VARCHAR(50) NULL;
CREATE INDEX idx_manheim_item ON car_crawler_manheim (item_id);
```

## 幂等
重跑 `ensureItemIdColumn` 应返回 `{ added: false }`，且不重复建索引（Duplicate key name 被吞）。

## 回滚（如需）
```sql
ALTER TABLE car_crawler_manheim DROP COLUMN item_id;
```
列可空、无数据依赖，删除安全。

## 权限
`admin` 账号具备 ALTER/INDEX（rds_superuser_role），已验证。
