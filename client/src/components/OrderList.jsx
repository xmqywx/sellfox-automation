import React, { useState } from 'react';
import { ListOrdered, FileText, ClipboardList } from 'lucide-react';

function OrderList({ orders, selectedOrders, onSelectionChange, automationStatus }) {
  const [selectAll, setSelectAll] = useState(true);

  const handleSelectAll = (e) => {
    const checked = e.target.checked;
    setSelectAll(checked);
    onSelectionChange(checked ? [...orders] : []);
  };

  const handleSelectOrder = (orderId, checked) => {
    if (checked) {
      onSelectionChange([...selectedOrders, orderId]);
    } else {
      onSelectionChange(selectedOrders.filter((id) => id !== orderId));
    }
  };

  const isSelected = (orderId) => selectedOrders.includes(orderId);

  // Get order status based on automation state
  const getOrderStatus = () => {
    if (automationStatus === 'completed') return { text: '已完成', class: 'done' };
    if (automationStatus === 'running') return { text: '处理中', class: 'processing' };
    if (automationStatus === 'error') return { text: '出错', class: 'error' };
    return { text: '待处理', class: 'pending' };
  };

  const orderStatus = getOrderStatus();

  return (
    <div className="order-list section" style={{ flex: 1 }}>
      <div className="order-list-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            className="order-checkbox"
            checked={selectAll && orders.length > 0 && selectedOrders.length === orders.length}
            onChange={handleSelectAll}
            disabled={orders.length === 0}
          />
          <span className="section-title">
            <ListOrdered size={16} /> 订单列表 ({selectedOrders.length}/{orders.length})
          </span>
        </div>
        {orders.length > 0 && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => {
              setSelectAll(!selectAll);
              onSelectionChange(selectAll ? [] : [...orders]);
            }}
          >
            {selectAll ? '取消全选' : '全选'}
          </button>
        )}
      </div>
      <div className="order-list-content">
        {orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ClipboardList size={28} />
            </div>
            <p>暂无订单</p>
            <p style={{ fontSize: '12px', marginTop: '8px', color: 'var(--text-muted)' }}>
              拖拽 Excel 文件到上方区域
            </p>
          </div>
        ) : (
          orders.map((orderId) => (
            <div key={orderId} className="order-item">
              <input
                type="checkbox"
                className="order-checkbox"
                checked={isSelected(orderId)}
                onChange={(e) => handleSelectOrder(orderId, e.target.checked)}
              />
              <span className="order-id">{orderId}</span>
              <span className={`order-status ${orderStatus.class}`}>{orderStatus.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default OrderList;
