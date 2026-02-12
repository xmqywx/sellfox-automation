import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2 } from 'lucide-react';

function LogViewer({ logs, onClear }) {
  const contentRef = useRef(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="log-viewer section">
      <div className="section-header">
        <h3 className="section-title"><Terminal size={16} /> 运行日志 ({logs.length})</h3>
        <button
          className="btn btn-sm btn-secondary"
          onClick={onClear}
          disabled={logs.length === 0}
        >
          <Trash2 size={14} /> 清空
        </button>
      </div>
      <div className="log-viewer-content" ref={contentRef}>
        {logs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
            }}
          >
            暂无日志
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={`log-entry ${log.type}`}>
              <span className="log-time">[{formatTime(log.timestamp)}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogViewer;
