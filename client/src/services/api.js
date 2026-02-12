const API_BASE = '/api';

/**
 * Make API request
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  if (config.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  try {
    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

// Config APIs
export async function getConfig() {
  return request('/config');
}

export async function updateConfig(updates) {
  return request('/config', {
    method: 'PUT',
    body: updates,
  });
}

export async function getChromeStatus(port) {
  const params = port ? `?port=${port}` : '';
  return request(`/config/chrome/status${params}`);
}

export async function launchChrome(port) {
  return request('/config/chrome/launch', {
    method: 'POST',
    body: { port },
  });
}

// Automation APIs
export async function getAutomationStatus() {
  const response = await request('/automation/status');
  return response.data || response;
}

export async function connectChrome(port) {
  return request('/automation/connect', {
    method: 'POST',
    body: { port },
  });
}

export async function disconnectChrome() {
  return request('/automation/disconnect', {
    method: 'POST',
  });
}

export async function startAutomation(orderIds) {
  return request('/automation/start', {
    method: 'POST',
    body: { orderIds },
  });
}

export async function pauseAutomation() {
  return request('/automation/pause', {
    method: 'POST',
  });
}

export async function resumeAutomation() {
  return request('/automation/resume', {
    method: 'POST',
  });
}

export async function stopAutomation() {
  return request('/automation/stop', {
    method: 'POST',
  });
}

export async function getScreenshot() {
  return request('/automation/screenshot');
}

export async function getWarehouses() {
  return request('/automation/warehouses');
}

// Excel APIs
export async function uploadExcel(file) {
  const formData = new FormData();
  formData.append('file', file);

  return request('/excel/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function getSheets() {
  return request('/excel/sheets');
}

export async function getColumns(sheetName) {
  return request(`/excel/columns/${encodeURIComponent(sheetName)}`);
}

export async function getPreview(sheetName, limit = 10) {
  return request(`/excel/preview/${encodeURIComponent(sheetName)}?limit=${limit}`);
}

export async function extractOrders(sheetName, columnName) {
  return request('/excel/extract-orders', {
    method: 'POST',
    body: { sheetName, columnName },
  });
}

export async function clearExcel() {
  return request('/excel/clear', {
    method: 'DELETE',
  });
}

export async function getExcelStatus() {
  return request('/excel/status');
}

export default {
  getConfig,
  updateConfig,
  getChromeStatus,
  launchChrome,
  getAutomationStatus,
  connectChrome,
  disconnectChrome,
  startAutomation,
  pauseAutomation,
  resumeAutomation,
  stopAutomation,
  getScreenshot,
  getWarehouses,
  uploadExcel,
  getSheets,
  getColumns,
  getPreview,
  extractOrders,
  clearExcel,
  getExcelStatus,
};
