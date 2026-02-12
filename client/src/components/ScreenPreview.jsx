import React from 'react';
import { Monitor, Radio } from 'lucide-react';

function ScreenPreview({ screenshot }) {
  return (
    <div className="screen-preview section">
      <div className="section-header">
        <h3 className="section-title"><Monitor size={16} /> 浏览器预览</h3>
        {screenshot && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Radio size={12} className="pulse" /> 实时更新
          </span>
        )}
      </div>
      <div className="screen-preview-content">
        {screenshot ? (
          <img
            src={`data:image/jpeg;base64,${screenshot}`}
            alt="Browser Screenshot"
            className="screen-preview-image"
          />
        ) : (
          <div className="screen-preview-placeholder">
            <Monitor size={48} strokeWidth={1} />
            <p style={{ fontSize: '0.8rem', marginTop: '12px' }}>连接后显示浏览器截图</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ScreenPreview;
