import React from 'react';
import { Play, Pause, Square, RotateCcw } from 'lucide-react';

function ControlButtons({
  status,
  chromeConnected,
  hasOrders,
  onStart,
  onPause,
  onResume,
  onStop,
}) {
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const canStart =
    chromeConnected &&
    hasOrders &&
    (status === 'idle' || status === 'stopped' || status === 'completed' || status === 'error');
  const canPause = isRunning;
  const canResume = isPaused;
  const canStop = isRunning || isPaused;

  return (
    <div className="control-buttons">
      {!isRunning && !isPaused ? (
        <button
          className="btn btn-success"
          onClick={onStart}
          disabled={!canStart}
        >
          <Play size={16} /> 开始自动化
        </button>
      ) : (
        <>
          {isPaused ? (
            <button
              className="btn btn-primary"
              onClick={onResume}
              disabled={!canResume}
            >
              <Play size={16} /> 继续
            </button>
          ) : (
            <button
              className="btn btn-warning"
              onClick={onPause}
              disabled={!canPause}
            >
              <Pause size={16} /> 暂停
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={onStop}
            disabled={!canStop}
          >
            <Square size={16} /> 停止
          </button>
        </>
      )}
    </div>
  );
}

export default ControlButtons;
