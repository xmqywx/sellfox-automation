import React from 'react';
import { Chrome, Wifi, Package, Zap } from 'lucide-react';

function StatusPanel({
  status,
  progress,
  chromeConnected,
  wsConnected,
  ordersCount,
}) {
  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return '空闲';
      case 'running':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'stopped':
        return '已停止';
      case 'completed':
        return '已完成';
      case 'error':
        return '出错';
      default:
        return status;
    }
  };

  const getStatusClass = () => {
    switch (status) {
      case 'running':
        return 'running';
      case 'paused':
        return 'paused';
      case 'completed':
        return 'connected';
      case 'error':
      case 'stopped':
        return 'disconnected';
      default:
        return '';
    }
  };

  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="status-bar">
      <div className="status-bar-items">
        <div className="status-bar-item">
          <Chrome size={14} />
          <span className="status-bar-label">Chrome</span>
          <span className={`status-indicator ${chromeConnected ? 'active' : ''}`}>
            {chromeConnected ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="status-bar-divider" />

        <div className="status-bar-item">
          <Wifi size={14} />
          <span className="status-bar-label">WebSocket</span>
          <span className={`status-indicator ${wsConnected ? 'active' : ''}`}>
            {wsConnected ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="status-bar-divider" />

        <div className="status-bar-item">
          <Package size={14} />
          <span className="status-bar-label">待处理</span>
          <span className="status-bar-value">{ordersCount} 个</span>
        </div>

        {progress.step && (
          <>
            <div className="status-bar-divider" />
            <div className="status-bar-item">
              <Zap size={14} className={status === 'running' ? 'animate-pulse' : ''} />
              <span className="status-bar-label">当前</span>
              <span className="status-bar-value truncate">{progress.step}</span>
            </div>
          </>
        )}

        {progress.total > 0 && (
          <>
            <div className="status-bar-divider" />
            <div className="status-bar-item progress-item">
              <span className="status-bar-label">进度</span>
              <div className="mini-progress">
                <div className="mini-progress-bar">
                  <div
                    className="mini-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="mini-progress-text">{progress.current}/{progress.total} ({progressPercent}%)</span>
              </div>
            </div>
          </>
        )}
      </div>

      <span className={`status-badge ${getStatusClass()}`}>
        <span className={`status-dot ${status === 'running' ? 'pulse' : ''}`}></span>
        {getStatusText()}
      </span>
    </div>
  );
}

export default StatusPanel;
