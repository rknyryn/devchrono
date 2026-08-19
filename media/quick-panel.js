/* DevChrono Quick Panel — client-side script with live timer */

(function () {
  const vscode = acquireVsCodeApi();

  // Live timer state
  let _total = 0;
  let _todayCompleted = 0;
  let _weekCompleted = 0;
  let _monthCompleted = 0;
  let _sessionStartMs = null;
  let _pomodoroPhase = 'idle';
  let _pomodoroPhaseStartMs = null;
  let _pomodoroPhaseTotalMs = 0;
  let _liveTimer = null;

  function fmt(seconds) {
    if (seconds <= 0) { return '0dk'; }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) { return `${h}s ${m}dk`; }
    if (m > 0) { return `${m}dk ${String(s).padStart(2, '0')}s`; }
    return `${s}s`;
  }

  function fmtCountdown(remainingMs) {
    const remainingSec = Math.ceil(Math.max(0, remainingMs) / 1000);
    const min = Math.floor(remainingSec / 60);
    const sec = remainingSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function tick() {
    const now = Date.now();
    const sessionElapsed = _sessionStartMs
      ? Math.floor((now - _sessionStartMs) / 1000)
      : 0;

    const todayEl = document.getElementById('stat-today');
    if (todayEl) { todayEl.textContent = fmt(_todayCompleted + sessionElapsed); }

    const weekEl = document.getElementById('stat-week');
    if (weekEl) { weekEl.textContent = fmt(_weekCompleted + sessionElapsed); }

    const monthEl = document.getElementById('stat-month');
    if (monthEl) { monthEl.textContent = fmt(_monthCompleted + sessionElapsed); }

    const totalEl = document.getElementById('stat-total');
    if (totalEl) { totalEl.textContent = fmt(_total + sessionElapsed); }

    const sessionEl = document.getElementById('stat-session');
    if (sessionEl) { sessionEl.textContent = sessionElapsed > 0 ? fmt(sessionElapsed) : '—'; }

    if (_pomodoroPhase !== 'idle' && _pomodoroPhaseStartMs && _pomodoroPhaseTotalMs) {
      const elapsed = now - _pomodoroPhaseStartMs;
      const remaining = _pomodoroPhaseTotalMs - elapsed;
      const emoji = _pomodoroPhase === 'break' ? '☕' : '🍅';
      const timerEl = document.getElementById('pomodoro-timer');
      if (timerEl) { timerEl.textContent = `${emoji} ${fmtCountdown(remaining)}`; }
    }
  }

  function startLiveTimer() {
    if (_liveTimer) { clearInterval(_liveTimer); }
    tick(); // immediate tick so display doesn't wait 1s
    _liveTimer = setInterval(tick, 1000);
  }

  function renderSevenDaysChart(days) {
    const container = document.getElementById('mini-chart');
    if (!container || !days || days.length === 0) { return; }
    const maxSec = Math.max(...days.map(d => d.seconds), 1);
    const rows = days.map(d => {
      const rowClass = 'mini-chart-row' + (d.isToday ? ' mini-chart-row--today' : '');
      return `<div class="${rowClass}">
        <div class="mini-chart-day">${d.label.split(' ').slice(0, 2).join(' ')}</div>
        <progress class="mini-chart-bar" value="${d.seconds}" max="${maxSec}"></progress>
        <div class="mini-chart-dur">${d.seconds > 0 ? fmt(d.seconds) : '—'}</div>
      </div>`;
    }).join('');
    container.innerHTML = rows;
  }

  function renderButtons(phase) {
    const container = document.getElementById('pomodoro-buttons');
    container.innerHTML = '';

    if (phase === 'idle') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = '🍅 Başlat';
      btn.addEventListener('click', () => vscode.postMessage({ command: 'startPomodoro' }));
      container.appendChild(btn);
    } else if (phase === 'work') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.textContent = '⏹ Durdur';
      btn.addEventListener('click', () => vscode.postMessage({ command: 'stopPomodoro' }));
      container.appendChild(btn);
    } else if (phase === 'break') {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'btn btn-primary';
      skipBtn.textContent = '⏭ Molayı Atla';
      skipBtn.addEventListener('click', () => vscode.postMessage({ command: 'skipBreak' }));
      container.appendChild(skipBtn);

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-secondary';
      stopBtn.textContent = '⏹ Durdur';
      stopBtn.addEventListener('click', () => vscode.postMessage({ command: 'stopPomodoro' }));
      container.appendChild(stopBtn);
    }
  }

  function applyUpdate(data) {
    const projectEl = document.getElementById('project-name');
    if (projectEl) { projectEl.textContent = data.projectName; }

    // Update live timer state
    _total = data.total;
    _todayCompleted = data.todayCompleted;
    _weekCompleted = data.weekCompleted;
    _monthCompleted = data.monthCompleted;
    _sessionStartMs = data.sessionStartMs;
    _pomodoroPhase = data.pomodoroPhase;
    _pomodoroPhaseStartMs = data.pomodoroPhaseStartMs;
    _pomodoroPhaseTotalMs = data.pomodoroPhaseTotalMs;

    renderSevenDaysChart(data.last7Days);

    // Update pomodoro timer text (when idle, clear it)
    if (data.pomodoroPhase === 'idle') {
      const timerEl = document.getElementById('pomodoro-timer');
      if (timerEl) { timerEl.textContent = ''; }
    }

    renderButtons(data.pomodoroPhase);
    startLiveTimer();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      applyUpdate(msg.data);
    }
  });

  document.getElementById('btn-summary').addEventListener('click', () => {
    vscode.postMessage({ command: 'showSummary' });
  });

  vscode.postMessage({ type: 'ready' });
}());
