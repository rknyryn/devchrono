// DevChrono Summary Panel — client-side webview script

(function () {
  'use strict';

  /** Full data received from the extension host — kept for re-filtering. */
  let allData = null;

  /** Live-timer state */
  let _sessionStartMs = null;
  let _baseTotal  = 0;
  let _baseToday  = 0;
  let _baseWeek   = 0;
  let _baseMonth  = 0;
  let _liveTimer  = null;

  /** Active filter state */
  let filterBranch = '';
  let filterFrom   = '';
  let filterTo     = '';

  /**
   * Format seconds into "Xs Ydkk" (Turkish: hours + minutes).
   * @param {number} totalSeconds
   * @returns {string}
   */
  function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}s ${String(m).padStart(2, '0')}dk`;
  }

  // Live-card format: shows seconds when under 1 hour (same as quick panel)
  function formatLive(totalSeconds) {
    if (totalSeconds <= 0) { return '0dk'; }
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) { return `${h}s ${m}dk`; }
    if (m > 0) { return `${m}dk ${String(s).padStart(2, '0')}s`; }
    return `${s}s`;
  }

  /**
   * Format an ISO date string as a short Turkish date+time.
   * @param {string} isoStr
   * @returns {string}
   */
  function formatSessionDate(isoStr) {
    try {
      const d = new Date(isoStr);
      const date = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
      const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      return `${date} ${time}`;
    } catch {
      return isoStr;
    }
  }

  /**
   * Live-tick: recomputes stat cards every second from sessionStartMs.
   */
  function tick() {
    const elapsed = _sessionStartMs
      ? Math.floor((Date.now() - _sessionStartMs) / 1000)
      : 0;
    setValue('stat-total',  formatLive(_baseTotal  + elapsed));
    setValue('stat-today',  formatLive(_baseToday  + elapsed));
    setValue('stat-week',   formatLive(_baseWeek   + elapsed));
    setValue('stat-month',  formatLive(_baseMonth  + elapsed));
  }

  function startLiveTimer() {
    if (_liveTimer) { clearInterval(_liveTimer); }
    tick(); // immediate first render
    _liveTimer = setInterval(tick, 1000);
  }

  /**
   * @param {Array} branchGroups
   * @returns {Array}
   */
  function applyFilters(branchGroups) {
    const query  = filterBranch.toLowerCase().trim();
    const fromMs = filterFrom ? new Date(filterFrom).getTime()            : 0;
    const toMs   = filterTo   ? new Date(filterTo + 'T23:59:59').getTime(): Infinity;
    const hasDateFilter = filterFrom || filterTo;

    return branchGroups
      .filter(function (group) {
        // Branch name filter — partial, case-insensitive
        if (query && !group.branch.toLowerCase().includes(query)) {
          return false;
        }
        // Date range filter — group must have at least one session in range
        if (hasDateFilter) {
          return group.sessions.some(function (s) {
            const t = new Date(s.startTime).getTime();
            return t >= fromMs && t <= toMs;
          });
        }
        return true;
      })
      .map(function (group) {
        if (!hasDateFilter) { return group; }
        // Narrow sessions within matched group to those in range
        const filtered = group.sessions.filter(function (s) {
          const t = new Date(s.startTime).getTime();
          return t >= fromMs && t <= toMs;
        });
        const filteredTotal = filtered.reduce(function (acc, s) { return acc + (s.duration || 0); }, 0);
        return Object.assign({}, group, {
          sessions:     filtered,
          sessionCount: filtered.length,
          totalSeconds: filteredTotal,
        });
      });
  }

  /**
   * Render the full summary data into the DOM.
   * @param {Object} data
   */
  function render(data) {
    // Header
    const headerEl = document.getElementById('project-name');
    if (headerEl) {
      headerEl.textContent = data.projectName || 'DevChrono';
    }

    // Stat cards are updated by the live timer (tick()) — not here.

    // Chart
    const chartEl = document.getElementById('chart');
    if (chartEl) {
      const days = data.last7Days || [];
      if (days.length === 0) {
        chartEl.innerHTML = '<div class="empty-state">Henüz veri yok.</div>';
      } else {
        const maxSeconds = Math.max(...days.map(d => d.seconds), 1);
        chartEl.innerHTML = days.map(function (day) {
          const dur = formatDuration(day.seconds);
          const todayClass = day.isToday ? ' chart-row--today' : '';
          return (
            '<div class="chart-row' + todayClass + '">' +
              '<span class="chart-day">' + escapeHtml(day.label) + '</span>' +
              '<progress class="chart-bar" value="' + day.seconds + '" max="' + maxSeconds + '"></progress>' +
              '<span class="chart-duration">' + escapeHtml(dur) + '</span>' +
            '</div>'
          );
        }).join('');
      }
    }

    // Branch groups — apply active filters
    renderBranchGroups(data.branchGroups || []);

    // Pomodoro stats
    renderPomodoroStats(data);
  }

  /**
   * Render the filtered branch groups list and update the filter status bar.
   * @param {Array} allGroups  — unfiltered branch groups from allData
   */
  function renderBranchGroups(allGroups) {
    const titleEl  = document.getElementById('sessions-title');
    const listEl   = document.getElementById('session-list');
    const statusEl = document.getElementById('filter-status');
    const clearBtn = document.getElementById('filter-clear');

    if (!titleEl || !listEl || !statusEl || !clearBtn) { return; }

    const isFiltering = filterBranch || filterFrom || filterTo;
    const filtered    = applyFilters(allGroups);

    // Clear button visibility
    clearBtn.hidden = !isFiltering;

    if (allGroups.length === 0) {
      titleEl.style.display = 'none';
      listEl.innerHTML = '';
      statusEl.hidden  = true;
      return;
    }

    titleEl.style.display = '';

    // Filter status line
    if (isFiltering) {
      statusEl.hidden = false;
      if (filtered.length === 0) {
        statusEl.textContent = '⚠ Eşleşen dal bulunamadı.';
        statusEl.className   = 'filter-status filter-status--empty';
      } else {
        const total = allGroups.length;
        statusEl.textContent = `${filtered.length} / ${total} dal gösteriliyor`;
        statusEl.className   = 'filter-status filter-status--active';
      }
    } else {
      statusEl.hidden = true;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Filtrelerle eşleşen oturum yok.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function (group) {
      const branchLabel = group.branch || '(dalsız)';
      const totalDur    = formatDuration(group.totalSeconds || 0);

      const sessionsHtml = group.sessions.map(function (session) {
        const dateStr = formatSessionDate(session.startTime);
        const durStr  = formatDuration(session.duration || 0);
        const count   = session.commits ? session.commits.length : 0;

        const commitsBadge = count > 0
          ? '<button class="commit-badge" data-count="' + count + '" aria-expanded="false">' + count + ' commit ▶</button>'
          : '';

        const commitsHtml = count > 0
          ? session.commits.map(function (c) {
              const msg = c.message
                ? '<span class="commit-msg">' + escapeHtml(c.message) + '</span>'
                : '';
              return (
                '<div class="commit-item">' +
                  '<span class="commit-hash">' + escapeHtml(c.short) + '</span>' +
                  msg +
                '</div>'
              );
            }).join('')
          : '';

        const commitListHtml = count > 0
          ? '<div class="commit-list" hidden>' + commitsHtml + '</div>'
          : '';

        return (
          '<div class="session-entry">' +
            '<div class="session-row">' +
              '<span class="session-date">' + escapeHtml(dateStr) + '</span>' +
              '<span class="session-dur">' + escapeHtml(durStr) + '</span>' +
              commitsBadge +
            '</div>' +
            commitListHtml +
          '</div>'
        );
      }).join('');

      return (
        '<div class="branch-group">' +
          '<div class="branch-header" role="button" aria-expanded="false" tabindex="0">' +
            '<span class="branch-chevron">▶</span>' +
            '<span class="branch-icon">⎇</span>' +
            '<span class="branch-name">' + escapeHtml(branchLabel) + '</span>' +
            '<span class="branch-meta">' + group.sessionCount + ' oturum</span>' +
            '<span class="branch-total">' + escapeHtml(totalDur) + '</span>' +
          '</div>' +
          '<div class="branch-body" hidden>' + sessionsHtml + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function setValue(id, text) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render the Pomodoro stats section.
   * @param {Object} data
   */
  function renderPomodoroStats(data) {
    const section = document.getElementById('pomodoro-stats-section');
    if (!section) { return; }

    const todayCount = data.pomodoroToday || 0;
    const weekCount  = data.pomodoroWeek  || 0;

    if (todayCount === 0 && weekCount === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    setValue('pomo-today-count', todayCount + ' pomodoro');
    setValue('pomo-today-time',  formatDuration(data.pomodoroTimeToday || 0));
    setValue('pomo-week-count',  weekCount  + ' pomodoro');
    setValue('pomo-week-time',   formatDuration(data.pomodoroTimeWeek  || 0));
  }

  // ── Filter wire-up ──────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    const branchInput = document.getElementById('filter-branch');
    const fromInput   = document.getElementById('filter-from');
    const toInput     = document.getElementById('filter-to');
    const clearBtn    = document.getElementById('filter-clear');
    const exportBtn   = document.getElementById('btn-export');

    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (vscodeApi) { vscodeApi.postMessage({ type: 'exportCsv' }); }
      });
    }

    if (branchInput) {
      branchInput.addEventListener('input', function () {
        filterBranch = branchInput.value;
        if (allData) { renderBranchGroups(allData.branchGroups || []); }
      });
    }

    if (fromInput) {
      fromInput.addEventListener('change', function () {
        filterFrom = fromInput.value;
        if (allData) { renderBranchGroups(allData.branchGroups || []); }
      });
    }

    if (toInput) {
      toInput.addEventListener('change', function () {
        filterTo = toInput.value;
        if (allData) { renderBranchGroups(allData.branchGroups || []); }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        filterBranch = '';
        filterFrom   = '';
        filterTo     = '';
        if (branchInput) { branchInput.value = ''; }
        if (fromInput)   { fromInput.value   = ''; }
        if (toInput)     { toInput.value     = ''; }
        if (allData) { renderBranchGroups(allData.branchGroups || []); }
      });
    }
  });

  // Event delegation for branch header collapse/expand
  document.addEventListener('click', function (e) {
    const header = e.target.closest('.branch-header');
    if (!header) { return; }

    const group   = header.closest('.branch-group');
    if (!group) { return; }
    const body    = group.querySelector('.branch-body');
    const chevron = header.querySelector('.branch-chevron');
    if (!body) { return; }

    const isOpen = header.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      body.setAttribute('hidden', '');
      header.setAttribute('aria-expanded', 'false');
      if (chevron) { chevron.textContent = '▶'; }
    } else {
      body.removeAttribute('hidden');
      header.setAttribute('aria-expanded', 'true');
      if (chevron) { chevron.textContent = '▼'; }
    }
  });

  // Keyboard support for branch header (Enter / Space)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') { return; }
    const header = e.target.closest('.branch-header');
    if (!header) { return; }
    e.preventDefault();
    header.click();
  });

  // Event delegation for commit badge toggle (CSP-safe — no inline handlers)
  document.addEventListener('click', function (e) {
    const badge = e.target.closest('.commit-badge');
    if (!badge) { return; }

    const entry = badge.closest('.session-entry');
    if (!entry) { return; }
    const commitList = entry.querySelector('.commit-list');
    if (!commitList) { return; }

    const isOpen = badge.getAttribute('aria-expanded') === 'true';
    const count  = badge.dataset.count || '';

    if (isOpen) {
      commitList.setAttribute('hidden', '');
      badge.setAttribute('aria-expanded', 'false');
      badge.textContent = count + ' commit ▶';
    } else {
      commitList.removeAttribute('hidden');
      badge.setAttribute('aria-expanded', 'true');
      badge.textContent = count + ' commit ▾';
    }
  });

  // Listen for messages from the extension host
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message && message.type === 'update') {
      allData = message.data;

      // Seed live-timer base values (completed sessions only — active counted live)
      _sessionStartMs = allData.sessionStartMs || null;
      _baseTotal  = allData.total    || 0;
      _baseToday  = allData.today    || 0;
      _baseWeek   = allData.thisWeek || 0;
      _baseMonth  = allData.thisMonth || 0;

      render(allData);
      startLiveTimer();
    }
  });

  // Signal the extension host that the webview script is fully loaded and ready
  // to receive data. The message listener above is already registered at this point.
  // acquireVsCodeApi() may only be called once per webview lifetime.
  const vscodeApi = (function () { try { return acquireVsCodeApi(); } catch { return null; } })();
  if (vscodeApi) { vscodeApi.postMessage({ type: 'ready' }); }
}());
