/**
 * Logger utility with colored output
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const logLevels = {
  debug: { color: colors.gray, label: 'DEBUG' },
  info: { color: colors.blue, label: 'INFO' },
  success: { color: colors.green, label: 'SUCCESS' },
  warn: { color: colors.yellow, label: 'WARN' },
  error: { color: colors.red, label: 'ERROR' },
};

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function createLogFunction(level) {
  const { color, label } = logLevels[level];
  return (...args) => {
    const timestamp = formatTimestamp();
    const prefix = `${colors.gray}[${timestamp}]${colors.reset} ${color}[${label}]${colors.reset}`;
    console.log(prefix, ...args);
  };
}

export const logger = {
  debug: createLogFunction('debug'),
  info: createLogFunction('info'),
  success: createLogFunction('success'),
  warn: createLogFunction('warn'),
  error: createLogFunction('error'),

  // Log with custom color
  custom: (color, label, ...args) => {
    const timestamp = formatTimestamp();
    const prefix = `${colors.gray}[${timestamp}]${colors.reset} ${color}[${label}]${colors.reset}`;
    console.log(prefix, ...args);
  },
};

export default logger;
