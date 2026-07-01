// src/config.js
import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v) => v === 'true';

// loadConfig 接受 env 对象（默认 process.env），便于测试注入
export function loadConfig(env = process.env) {
  return {
    baseUrl: 'https://www.manheim.co.nz',
    auctionId: env.AUCTION_ID || 'ND060726',
    franchiseId: env.FRANCHISE_ID || 'SALVAGENZ',
    maxConcurrency: num(env.MAX_CONCURRENCY, 4),
    minDelayMs: num(env.MIN_DELAY_MS, 500),
    maxRequestRetries: num(env.MAX_RETRIES, 5),
    dbPath: env.DB_PATH || './data/manheim.sqlite',
    proxyUrl: env.PROXY_URL || undefined,
    s3: {
      enabled: bool(env.S3_ENABLED),
      bucket: env.S3_BUCKET || '',
      region: env.S3_REGION || '',
      prefix: env.S3_PREFIX || 'manheim/',
      accessKeyId: env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    },
    mysql: {
      enabled: bool(env.MYSQL_SYNC),
      host: env.MYSQL_HOST || '',
      port: num(env.MYSQL_PORT, 3306),
      user: env.MYSQL_USER || '',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || '',
    },
  };
}

export const config = loadConfig();
