// src/crawler/fields.js
export const FIELD_MAP = {
  'Build Year': 'year',
  'Make': 'make',
  'Body Type': 'body_type',
  'Model': 'model',
  'Body Colour': 'colour',
  'Variant': 'variant',
  'Doors': 'doors',
  'Seats': 'seats',
  'Odometer': 'odometer',
  'Transmission': 'transmission',
  'Engine': 'engine',
  'Fuel Type': 'fuel_type',
  'Registration': 'registration',
  'VIN': 'vin',
  'No of Keys': 'no_of_keys',
  'Seller Type': 'seller_type',
};

// 去掉 label 中的冒号（对齐 Java 的 StrUtil.removeAny(type, ":")），映射赋值
export function applyPair(vehicle, label, value) {
  const key = String(label).replace(/:/g, '').trim();
  const col = FIELD_MAP[key];
  if (col) vehicle[col] = String(value).replace(/\s+/g, ' ').trim();
}
