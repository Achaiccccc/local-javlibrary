/**
 * 扫描单例状态（主进程与 IPC 共用）
 * 启动时自动扫描、设置页触发的完整/增量扫描均更新此状态，避免重复触发
 */
let scanInProgress = false;
let currentScanType = null; // 'full' | 'incremental' | null

function getScanInProgress() {
  return scanInProgress;
}

function setScanInProgress(value) {
  scanInProgress = !!value;
}

function getCurrentScanType() {
  return currentScanType;
}

function setCurrentScanType(type) {
  currentScanType = type;
}

function setScanRunning(type) {
  scanInProgress = true;
  currentScanType = type;
}

function clearScanRunning() {
  scanInProgress = false;
  currentScanType = null;
}

module.exports = {
  getScanInProgress,
  setScanInProgress,
  getCurrentScanType,
  setCurrentScanType,
  setScanRunning,
  clearScanRunning
};
