import React, { useState, useEffect, useCallback } from 'react';
import ConfigPanel from './components/ConfigPanel';
import OrderList from './components/OrderList';
import StatusPanel from './components/StatusPanel';
import ScreenPreview from './components/ScreenPreview';
import LogViewer from './components/LogViewer';
import ControlButtons from './components/ControlButtons';
import useWebSocket from './hooks/useWebSocket';
import * as api from './services/api';

function App() {
  const [theme, setTheme] = useState('dark');
  const [chromeStatus, setChromeStatus] = useState({ connected: false });
  const [orderIds, setOrderIds] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [automationStatus, setAutomationStatus] = useState('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, step: '' });
  const [logs, setLogs] = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [notification, setNotification] = useState(null);
  const [excelInfo, setExcelInfo] = useState(null);
  const [config, setConfig] = useState(null);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const result = await api.getConfig();
        if (result.success) {
          setConfig(result.data);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };
    loadConfig();
  }, []);

  // WebSocket connection
  const { isConnected: wsConnected, lastMessage, connectionError: wsError } = useWebSocket();

  // Log WebSocket errors
  useEffect(() => {
    if (wsError) {
      console.error('WebSocket Error:', wsError);
      setLogs((prev) => [
        ...prev.slice(-99),
        { type: 'error', message: wsError, timestamp: Date.now() },
      ]);
    }
  }, [wsError]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const { type, data } = lastMessage;

    switch (type) {
      case 'status':
        if (data.status) {
          setAutomationStatus(data.status);
        }
        break;

      case 'progress':
        setProgress({
          current: data.progress || 0,
          total: data.totalSteps || 0,
          step: data.currentStep || '',
        });
        setAutomationStatus(data.status || automationStatus);
        break;

      case 'log':
        setLogs((prev) => [
          ...prev.slice(-99),
          {
            type: data.type,
            message: data.message,
            timestamp: data.timestamp || Date.now(),
          },
        ]);
        break;

      case 'screenshot':
        setScreenshot(data.image);
        break;

      case 'notification':
        setNotification({
          type: data.type,
          title: data.title,
          message: data.message,
        });
        // Auto-hide after 10 seconds
        setTimeout(() => setNotification(null), 10000);
        break;

      case 'error':
        setLogs((prev) => [
          ...prev.slice(-99),
          {
            type: 'error',
            message: data.message,
            timestamp: Date.now(),
          },
        ]);
        break;
    }
  }, [lastMessage]);

  // Check Chrome status periodically
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await api.getAutomationStatus();
        setChromeStatus({ connected: status.connected });
        if (status.status) {
          setAutomationStatus(status.status);
        }
      } catch (error) {
        console.error('Failed to get status:', error);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // Handle Chrome connection
  const handleConnect = async (port) => {
    try {
      addLog('info', `正在连接到 Chrome (端口: ${port})...`);
      const result = await api.connectChrome(port);
      if (result.success) {
        setChromeStatus({ connected: true });
        addLog('success', 'Chrome 连接成功');
      } else {
        addLog('error', result.message || '连接失败');
      }
    } catch (error) {
      addLog('error', `连接失败: ${error.message}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnectChrome();
      setChromeStatus({ connected: false });
      setScreenshot(null);
      addLog('info', '已断开 Chrome 连接');
    } catch (error) {
      addLog('error', `断开连接失败: ${error.message}`);
    }
  };

  const handleLaunchChrome = async (port) => {
    try {
      addLog('info', `正在启动 Chrome (端口: ${port})...`);
      const result = await api.launchChrome(port);
      if (result.success) {
        addLog('success', result.data?.message || 'Chrome 已启动');
        // Auto-connect after launch
        setTimeout(() => handleConnect(port), 1000);
      } else {
        addLog('error', result.data?.message || '启动失败');
      }
    } catch (error) {
      addLog('error', `启动 Chrome 失败: ${error.message}`);
    }
  };

  // Handle file upload
  const handleFileUpload = async (file) => {
    try {
      addLog('info', `正在上传文件: ${file.name}`);
      const result = await api.uploadExcel(file);
      if (result.success) {
        setExcelInfo(result.data);
        addLog('success', `文件上传成功: ${result.data.sheets.length} 个工作表`);
      } else {
        addLog('error', result.error || '上传失败');
      }
      return result;
    } catch (error) {
      addLog('error', `上传失败: ${error.message}`);
      throw error;
    }
  };

  // Handle order extraction
  const handleExtractOrders = async (sheetName, columnName) => {
    try {
      addLog('info', `正在提取订单号 (${columnName})...`);
      const result = await api.extractOrders(sheetName, columnName);
      if (result.success) {
        setOrderIds(result.data.orderIds);
        setSelectedOrders(result.data.orderIds);
        addLog('success', `提取到 ${result.data.count} 个订单号`);
      } else {
        addLog('error', result.error || '提取失败');
      }
    } catch (error) {
      addLog('error', `提取订单失败: ${error.message}`);
    }
  };

  // Add log entry
  const addLog = useCallback((type, message) => {
    setLogs((prev) => [
      ...prev.slice(-99),
      { type, message, timestamp: Date.now() },
    ]);
  }, []);

  // Control handlers
  const handleStart = async () => {
    if (selectedOrders.length === 0) {
      addLog('warn', '请先选择要处理的订单');
      return;
    }

    try {
      addLog('info', `开始处理 ${selectedOrders.length} 个订单...`);
      const result = await api.startAutomation(selectedOrders);
      if (result.success) {
        setAutomationStatus('running');
      } else {
        addLog('error', result.error || '启动失败');
      }
    } catch (error) {
      addLog('error', `启动自动化失败: ${error.message}`);
    }
  };

  const handlePause = async () => {
    try {
      await api.pauseAutomation();
      setAutomationStatus('paused');
      addLog('info', '自动化已暂停');
    } catch (error) {
      addLog('error', `暂停失败: ${error.message}`);
    }
  };

  const handleResume = async () => {
    try {
      await api.resumeAutomation();
      setAutomationStatus('running');
      addLog('info', '自动化已恢复');
    } catch (error) {
      addLog('error', `恢复失败: ${error.message}`);
    }
  };

  const handleStop = async () => {
    try {
      await api.stopAutomation();
      setAutomationStatus('stopped');
      addLog('info', '自动化已停止');
    } catch (error) {
      addLog('error', `停止失败: ${error.message}`);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  // Handle config change
  const handleConfigChange = async (updates) => {
    try {
      const result = await api.updateConfig(updates);
      if (result.success) {
        setConfig(result.data);
        addLog('info', '配置已更新');
      }
    } catch (error) {
      addLog('error', `更新配置失败: ${error.message}`);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          Sellfox <span>订单自动化工具</span>
        </h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? '浅色' : '深色'}
        </button>
      </header>

      <main className="app-main">
        <div className="left-panel">
          <ConfigPanel
            chromeStatus={chromeStatus}
            excelInfo={excelInfo}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onLaunchChrome={handleLaunchChrome}
            onFileUpload={handleFileUpload}
            onExtractOrders={handleExtractOrders}
            config={config}
            onConfigChange={handleConfigChange}
          />
          <OrderList
            orders={orderIds}
            selectedOrders={selectedOrders}
            onSelectionChange={setSelectedOrders}
            automationStatus={automationStatus}
          />
        </div>

        <div className="right-panel">
          {/* Control buttons at top - always visible */}
          <div className="top-controls">
            <StatusPanel
              status={automationStatus}
              progress={progress}
              chromeConnected={chromeStatus.connected}
              wsConnected={wsConnected}
              ordersCount={selectedOrders.length}
            />
            <ControlButtons
              status={automationStatus}
              chromeConnected={chromeStatus.connected}
              hasOrders={selectedOrders.length > 0}
              onStart={handleStart}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
            />
          </div>
          {/* Scrollable content area */}
          <div className="content-area">
            <ScreenPreview screenshot={screenshot} />
            <LogViewer logs={logs} onClear={handleClearLogs} />
          </div>
        </div>
      </main>

      {notification && (
        <div className={`notification ${notification.type}`}>
          <button
            className="notification-close"
            onClick={() => setNotification(null)}
          >
            x
          </button>
          <div className="notification-title">{notification.title}</div>
          <div className="notification-message">{notification.message}</div>
        </div>
      )}
    </div>
  );
}

export default App;
