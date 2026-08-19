(function() {
  const vscode = acquireVsCodeApi();

  let remainingSeconds = 0;
  let totalSeconds = 0;
  let countdownInterval = null;

  const countdownEl = document.getElementById('countdown');
  const progressFillEl = document.getElementById('progress-fill');
  const skipBtn = document.getElementById('skip-btn');

  // Signal ready to extension host
  vscode.postMessage({ type: 'ready' });

  // Skip button
  skipBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'skipBreak' });
  });

  // Receive state from extension host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'pomodoroState') {
      remainingSeconds = msg.remainingSeconds;
      totalSeconds = msg.totalSeconds;
      updateDisplay();
      startLocalCountdown();
    }
  });

  function updateDisplay() {
    const min = Math.floor(remainingSeconds / 60);
    const sec = remainingSeconds % 60;
    countdownEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    const pct = totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0;
    progressFillEl.style.width = `${pct}%`;
  }

  function startLocalCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); }
    countdownInterval = setInterval(() => {
      if (remainingSeconds > 0) {
        remainingSeconds--;
        updateDisplay();
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);
  }
})();
