import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, Settings, Plug, RefreshCw } from 'lucide-react';

function ConfigPanel({
  chromeStatus,
  excelInfo,
  onConnect,
  onDisconnect,
  onLaunchChrome,
  onFileUpload,
  onExtractOrders,
  config,
  onConfigChange,
}) {
  const [chromePort, setChromePort] = useState('9222');
  const [chromePath, setChromePath] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [selectedColumn, setSelectedColumn] = useState('');
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Initialize from config
  React.useEffect(() => {
    if (config?.chrome) {
      if (config.chrome.debugPort) setChromePort(String(config.chrome.debugPort));
      if (config.chrome.executablePath) setChromePath(config.chrome.executablePath);
    }
  }, [config]);

  const handleLaunchChrome = async () => {
    setIsLaunching(true);
    try {
      // Save config first if path changed
      if (chromePath && onConfigChange) {
        await onConfigChange({ chrome: { executablePath: chromePath } });
      }
      await onLaunchChrome(parseInt(chromePort));
    } finally {
      setIsLaunching(false);
    }
  };

  const processFile = async (file) => {
    if (!file) return;

    // Check file type
    const validTypes = ['.xlsx', '.xls'];
    const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validTypes.includes(fileExt)) {
      alert('请选择 Excel 文件 (.xlsx 或 .xls)');
      return;
    }

    setIsUploading(true);
    setFileName(file.name);

    try {
      const result = await onFileUpload(file);
      if (result?.success && result.data?.sheets?.length > 0) {
        const firstSheet = result.data.sheets[0];
        setSelectedSheet(firstSheet.name);
        if (firstSheet.headers?.length > 0) {
          // Try to find order column
          const orderCol = firstSheet.headers.find(
            (h) => h.includes('订单') || h.toLowerCase().includes('order')
          );
          const columnToUse = orderCol || firstSheet.headers[0];
          setSelectedColumn(columnToUse);

          // Auto-extract orders after upload
          if (columnToUse) {
            setTimeout(() => {
              onExtractOrders(firstSheet.name, columnToUse);
            }, 100);
          }
        }
      }
    } catch (error) {
      setFileName('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    await processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    await processFile(file);
  };

  const handleExtract = () => {
    if (selectedSheet && selectedColumn) {
      onExtractOrders(selectedSheet, selectedColumn);
    }
  };

  const sheets = excelInfo?.sheets || [];
  const currentSheet = sheets.find((s) => s.name === selectedSheet);
  const columns = currentSheet?.headers || [];

  return (
    <div className="section">
      <div className="section-header">
        <h3 className="section-title"><Settings size={16} /> 配置</h3>
        <span
          className={`status-badge ${chromeStatus.connected ? 'connected' : 'disconnected'}`}
        >
          <span className={`status-dot ${chromeStatus.connected ? 'pulse' : ''}`}></span>
          {chromeStatus.connected ? '已连接' : '未连接'}
        </span>
      </div>
      <div className="section-content">
        {/* Chrome Connection */}
        <div className="form-group">
          <label className="form-label">Chrome 调试端口</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              className="form-input"
              value={chromePort}
              onChange={(e) => setChromePort(e.target.value)}
              placeholder="9222"
              style={{ width: '100px' }}
            />
            {chromeStatus.connected ? (
              <button
                className="btn btn-secondary"
                onClick={onDisconnect}
              >
                断开
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => onConnect(parseInt(chromePort))}
                >
                  连接
                </button>
                <button
                  className="btn btn-success"
                  onClick={handleLaunchChrome}
                  disabled={isLaunching}
                >
                  {isLaunching ? '启动中...' : '启动 Chrome'}
                </button>
              </>
            )}
          </div>
          <button
            className="btn-link"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ marginTop: '8px', fontSize: '12px' }}
          >
            {showAdvanced ? '▼ 隐藏高级设置' : '▶ 显示高级设置'}
          </button>
        </div>

        {/* Advanced Chrome Settings */}
        {showAdvanced && (
          <div className="form-group" style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px' }}>
            <label className="form-label">Chrome 路径 (可选)</label>
            <input
              type="text"
              className="form-input"
              value={chromePath}
              onChange={(e) => setChromePath(e.target.value)}
              placeholder={
                navigator.platform.includes('Win')
                  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
              }
            />
            <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
              留空将自动检测系统中的 Chrome 位置
            </small>
          </div>
        )}

        {/* File Upload - Large Drag Zone */}
        <div className="form-group">
          <label className="form-label">Excel 文件 (拖拽上传后自动提取订单)</label>
          <div
            className="file-upload-zone"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="file-upload-input"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
            />
            <div className={`file-upload-content ${fileName ? 'has-file' : ''} ${isDragging ? 'dragging' : ''}`}>
              {isUploading ? (
                <>
                  <div className="upload-icon"><RefreshCw className="animate-spin" /></div>
                  <div className="upload-text">上传中...</div>
                </>
              ) : isDragging ? (
                <>
                  <div className="upload-icon"><Upload /></div>
                  <div className="upload-text">松开以上传文件</div>
                </>
              ) : fileName ? (
                <>
                  <div className="upload-icon"><CheckCircle /></div>
                  <div className="upload-text">{fileName}</div>
                  <div className="upload-hint">点击或拖拽更换文件</div>
                </>
              ) : (
                <>
                  <div className="upload-icon"><FileSpreadsheet /></div>
                  <div className="upload-text">点击选择或拖拽 Excel 文件</div>
                  <div className="upload-hint">支持 .xlsx, .xls 格式</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sheet & Column Selector - Compact inline */}
        {sheets.length > 0 && (
          <div className="form-group">
            <label className="form-label">数据源</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                className="form-select"
                value={selectedSheet}
                onChange={(e) => {
                  setSelectedSheet(e.target.value);
                  setSelectedColumn('');
                }}
                style={{ flex: 1 }}
              >
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} 行)
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(e.target.value)}
                style={{ flex: 1 }}
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleExtract}
                disabled={!selectedSheet || !selectedColumn}
              >
                重新提取
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default ConfigPanel;
