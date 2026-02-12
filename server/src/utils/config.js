import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '../../../config.yaml');

// Default configuration
const defaultConfig = {
  server: {
    port: 7001,
    enableLogging: true,
  },
  chrome: {
    debugPort: 9222,
    executablePath: '',
    userDataDir: '',
  },
  sellfox: {
    baseUrl: 'https://www.sellfox.cn',
    orderShipPath: '/order/ship',
    defaultWarehouse: '',
    operationDelay: 500,
    screenshotInterval: 1000,
  },
  excel: {
    defaultOrderColumn: '订单号',
    supportedTypes: ['.xlsx', '.xls'],
    maxFileSize: 10,
  },
  automation: {
    batchSize: 50,
    batchDelay: 2000,
    maxRetries: 3,
    timeout: 30000,
  },
};

let cachedConfig = null;

/**
 * Load configuration from YAML file
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
      const fileConfig = yaml.load(fileContent) || {};
      cachedConfig = deepMerge(defaultConfig, fileConfig);
    } else {
      cachedConfig = { ...defaultConfig };
      // Create default config file
      saveConfig(cachedConfig);
    }
  } catch (error) {
    console.error('Error loading config:', error.message);
    cachedConfig = { ...defaultConfig };
  }

  return cachedConfig;
}

/**
 * Save configuration to YAML file
 * @param {Object} config - Configuration object to save
 */
export function saveConfig(config) {
  try {
    const yamlContent = yaml.dump(config, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    fs.writeFileSync(CONFIG_PATH, yamlContent, 'utf8');
    cachedConfig = config;
    return true;
  } catch (error) {
    console.error('Error saving config:', error.message);
    return false;
  }
}

/**
 * Update specific configuration values
 * @param {Object} updates - Partial configuration updates
 */
export function updateConfig(updates) {
  const currentConfig = loadConfig();
  const newConfig = deepMerge(currentConfig, updates);
  return saveConfig(newConfig);
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Reset configuration to defaults
 */
export function resetConfig() {
  cachedConfig = null;
  return saveConfig({ ...defaultConfig });
}

/**
 * Clear cached configuration
 */
export function clearConfigCache() {
  cachedConfig = null;
}

export default { loadConfig, saveConfig, updateConfig, resetConfig, clearConfigCache };
