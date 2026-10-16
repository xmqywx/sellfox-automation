// src/crawler/enrich.js
// 新站 DOM 不含 uuid/plan_type，由编排按拍卖注入（生产 MySQL 这两列 NOT NULL）。
export function enrichVehicle(vehicle, cfg) {
  if (vehicle.uuid == null) vehicle.uuid = cfg.auctionId;
  if (vehicle.plan_type == null) vehicle.plan_type = cfg.planType || 'Salvage';
}
