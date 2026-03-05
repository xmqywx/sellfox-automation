import { useState, useEffect, useRef, useCallback } from 'react';

// Build WebSocket URL based on current page location
function getWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws`;

  console.log('[WebSocket] Connecting to:', url);

  return url;
}

function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const reconnectDelay = 3000;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = getWebSocketUrl();

    try {
      console.log('[WebSocket] Creating connection to:', wsUrl);
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        setIsConnected(false);

        // Auto-reconnect
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(
            `[WebSocket] Reconnecting in ${reconnectDelay / 1000}s... (attempt ${reconnectAttemptsRef.current})`
          );
          reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay);
        } else {
          setConnectionError('WebSocket 连接失败，请刷新页面重试');
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setConnectionError(`WebSocket 连接错误: ${wsUrl}`);
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setConnectionError(`无法创建 WebSocket 连接: ${error.message}`);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
  }, []);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Heartbeat
  useEffect(() => {
    if (!isConnected) return;

    const heartbeatInterval = setInterval(() => {
      send('ping');
    }, 30000);

    return () => clearInterval(heartbeatInterval);
  }, [isConnected, send]);

  return {
    isConnected,
    lastMessage,
    connectionError,
    connect,
    disconnect,
    send,
  };
}

export default useWebSocket;
