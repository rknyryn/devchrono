// DevChrono Git Timeline Panel — client-side webview script

(function () {
  'use strict';

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

  /**
   * Format an ISO date string as a compact Turkish date+time.
   * @param {string} isoStr
   * @returns {string}
   */
  function formatDate(isoStr) {
    if (!isoStr) { return '—'; }
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
   * Escape a string for safe HTML insertion.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render the timeline data into the DOM.
   * @param {Object} data
   */
  function render(data) {
    const projectEl = document.getElementById('project-name');
    if (projectEl) {
      projectEl.textContent = data.projectName || 'DevChrono';
    }

    const contentEl = document.getElementById('content');
    if (!contentEl) { return; }

    // No git repository
    if (!data.hasGit) {
      contentEl.innerHTML =
        '<div class="no-git">Bu workspace\'te git deposu bulunamadı. ' +
        'Git entegrasyonu yalnızca <code>git init</code> yapılmış projelerde çalışır.</div>';
      return;
    }

    // No commits recorded yet
    if (!data.entries || data.entries.length === 0) {
      contentEl.innerHTML =
        '<div class="empty-state">Henüz commit kaydı yok. ' +
        'DevChrono aktifken yaptığın commit\'ler burada görünür.</div>';
      return;
    }

    const count = data.entries.length;

    const tableHtml =
      '<p class="section-label">' +
        'Commit\'ler' +
        '<span class="count-badge">' + count + '</span>' +
      '</p>' +
      '<table class="timeline-table">' +
        '<thead>' +
          '<tr>' +
            '<th class="col-hash">Hash</th>' +
            '<th class="col-message">Mesaj</th>' +
            '<th class="col-date">Tarih</th>' +
            '<th class="col-duration">Oturum Süresi</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' +
          data.entries.map(function (entry) {
            const msgClass = entry.message
              ? 'col-message'
              : 'col-message no-message';
            const msgText = entry.message
              ? escapeHtml(entry.message)
              : '(mesaj yok)';
            const dateText = escapeHtml(formatDate(entry.authorDate || entry.sessionStart));
            const durText = escapeHtml(formatDuration(entry.sessionDuration || 0));
            return (
              '<tr>' +
                '<td class="col-hash">' + escapeHtml(entry.short) + '</td>' +
                '<td class="' + msgClass + '" title="' + escapeHtml(entry.message || '') + '">' +
                  msgText +
                '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-duration">' +
                  durText +
                  '<span class="duration-label">oturum toplamı</span>' +
                '</td>' +
              '</tr>'
            );
          }).join('') +
        '</tbody>' +
      '</table>' +
      '<p class="footer-note">' +
        'Süre = commit\'in yapıldığı oturumda harcanan toplam süre. ' +
        'Commit başına kesin süre gösterilmez.' +
      '</p>';

    contentEl.innerHTML = tableHtml;
  }

  // Listen for messages from the extension host
  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message && message.type === 'update') {
      render(message.data);
    }
  });

  // Signal the extension host that the webview script is ready to receive data.
  const vscodeApi = (function () { try { return acquireVsCodeApi(); } catch { return null; } })();
  if (vscodeApi) { vscodeApi.postMessage({ type: 'ready' }); }
}());
