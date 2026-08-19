import * as vscode from 'vscode';
import * as cp from 'child_process';
import { readLog } from '../storage/logStorage';
import { formatDuration } from '../utlis/timeFormatter';

const TR_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

interface CommitInfo {
  hash: string;    // full SHA
  short: string;   // first 7 chars
  message: string; // subject line from git log
}

interface SessionEntry {
  id: string;
  startTime: string;
  duration: number;
  branch?: string;
  commits: CommitInfo[];
}

interface BranchGroup {
  branch: string;
  totalSeconds: number;
  sessionCount: number;
  sessions: SessionEntry[];
}

interface DayEntry {
  date: string;    // "YYYY-MM-DD"
  label: string;   // e.g. "Sal 21 Nis"
  seconds: number;
  isToday: boolean;
}

interface SummaryData {
  projectName: string;
  total: number;         // completed sessions only — client adds live elapsed
  today: number;
  thisWeek: number;
  thisMonth: number;
  sessionStartMs: number | null; // null when no active session
  last7Days: DayEntry[];
  branchGroups: BranchGroup[];
  pomodoroToday: number;      // count of completed pomodoro sessions today
  pomodoroWeek: number;       // count of completed pomodoro sessions this week
  pomodoroTimeToday: number;  // total seconds of pomodoro work today
  pomodoroTimeWeek: number;   // total seconds of pomodoro work this week
}

export class SummaryPanel {
  public static currentPanel: SummaryPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SummaryPanel.currentPanel) {
      SummaryPanel.currentPanel._panel.reveal(column);
      SummaryPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'devchronoSummary',
      'DevChrono Summary',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    SummaryPanel.currentPanel = new SummaryPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(panel.webview);
    // Wait for the webview script to signal it's ready before posting data.
    // Calling _update() immediately after setting html drops the postMessage
    // because the message listener in summary.js hasn't registered yet.
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === 'ready') { this._update(); }
        if (message.type === 'exportCsv') {
          vscode.commands.executeCommand('devchrono.exportLog');
        }
      },
      null,
      this._disposables
    );
    this._startRefreshTimer();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Refresh data whenever the panel becomes visible again; pause timer when hidden
    this._panel.onDidChangeViewState(
      e => {
        if (e.webviewPanel.visible) {
          this._update();
          this._startRefreshTimer();
        } else {
          this._stopRefreshTimer();
        }
      },
      null,
      this._disposables
    );
  }

  private _startRefreshTimer(): void {
    if (this._refreshTimer !== undefined) { return; }
    this._refreshTimer = setInterval(() => this._update(), 60_000);
  }

  private _stopRefreshTimer(): void {
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  private _update(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }

    const log = readLog(folders[0].uri.fsPath);
    if (!log) {
      this._panel.webview.postMessage({
        type: 'update',
        data: { projectName: 'DevChrono', total: 0, today: 0, thisWeek: 0, thisMonth: 0, last7Days: [], sessions: [] },
      });
      return;
    }

    const now = new Date();
    const todayStr = toDateStr(now);

    // Monday of the current week
    const weekStart = new Date(now);
    const dayOfWeek = weekStart.getDay(); // 0 = Sunday
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    weekStart.setDate(weekStart.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    // First day of the current month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Active (in-progress) session — no endTime recorded yet
    const activeSession = log.sessions.find(s => !s.endTime);
    const sessionStartMs: number | null = activeSession
      ? new Date(activeSession.startTime).getTime()
      : null;
    // Snapshot elapsed used only for the chart bars (not the live stat cards)
    const currentElapsed = activeSession
      ? Math.max(0, Math.floor((Date.now() - new Date(activeSession.startTime).getTime()) / 1000))
      : 0;

    let total = 0;
    let today = 0;
    let thisWeek = 0;
    let thisMonth = 0;

    for (const session of log.sessions) {
      if (!session.endTime) { continue; } // skip active — client counts live
      const secs = session.duration || 0;
      total += secs;

      const sessionDate = new Date(session.startTime);
      if (toDateStr(sessionDate) === todayStr) {
        today += secs;
      }
      if (sessionDate >= weekStart) {
        thisWeek += secs;
      }
      if (sessionDate >= monthStart) {
        thisMonth += secs;
      }
    }

    // Build last-7-days entries (today first, 6 days ago last)
    const last7Days: DayEntry[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dateStr = toDateStr(d);

      const dayLabel = `${TR_DAYS[d.getDay()]} ${d.getDate()} ${TR_MONTHS[d.getMonth()]}`;

      const daySeconds = log.sessions
        .filter(s => toDateStr(new Date(s.startTime)) === dateStr)
        .reduce((acc, s) => acc + ((s === activeSession) ? currentElapsed : (s.duration || 0)), 0);

      last7Days.push({ date: dateStr, label: dayLabel, seconds: daySeconds, isToday: i === 0 });
    }

    const summaryData: SummaryData = {
      projectName: log.projectName,
      total,
      today,
      thisWeek,
      thisMonth,
      sessionStartMs,
      last7Days,
      branchGroups: buildBranchGroups(log.sessions, folders[0].uri.fsPath),
      ...buildPomodoroStats(log.sessions, todayStr, weekStart),
    };

    this._panel.webview.postMessage({ type: 'update', data: summaryData });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'summary.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'summary.js')
    );

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>DevChrono Summary</title>
</head>
<body>

  <div class="panel-header">
    <h1>⏱ DevChrono — <span id="project-name">…</span></h1>
    <button class="export-btn" id="btn-export" title="CSV olarak dışa aktar">⬇ CSV</button>
  </div>

  <div class="stats-grid">
    <div class="stat-card" data-card="total">
      <div class="stat-label">Toplam Süre</div>
      <div class="stat-value" id="stat-total">—</div>
    </div>
    <div class="stat-card" data-card="month">
      <div class="stat-label">Bu Ay</div>
      <div class="stat-value" id="stat-month">—</div>
    </div>
    <div class="stat-card" data-card="week">
      <div class="stat-label">Bu Hafta</div>
      <div class="stat-value" id="stat-week">—</div>
    </div>
    <div class="stat-card" data-card="today">
      <div class="stat-label">Bugün</div>
      <div class="stat-value" id="stat-today">—</div>
    </div>
  </div>

  <div class="section-title">Son 7 Gün</div>
  <div class="chart-container">
    <div id="chart"><div class="empty-state">Yükleniyor…</div></div>
  </div>

  <div id="pomodoro-stats-section" hidden>
    <div class="section-title">🍅 Pomodoro İstatistikleri</div>
    <div class="pomodoro-stats-grid">
      <div class="pomo-stat">
        <span class="pomo-label">Bugün</span>
        <span class="pomo-count" id="pomo-today-count">—</span>
        <span class="pomo-time" id="pomo-today-time">—</span>
      </div>
      <div class="pomo-stat">
        <span class="pomo-label">Bu Hafta</span>
        <span class="pomo-count" id="pomo-week-count">—</span>
        <span class="pomo-time" id="pomo-week-time">—</span>
      </div>
    </div>
  </div>

  <div class="section-title sessions-section-title" id="sessions-title">Dal Özeti</div>

  <div class="search-bar" id="search-bar">
    <span class="search-icon">🔍</span>
    <input type="text" id="filter-branch" class="filter-input" placeholder="Dal ara…" autocomplete="off" spellcheck="false">
    <span class="date-sep">|</span>
    <input type="date" id="filter-from" class="filter-date" title="Başlangıç tarihi">
    <span class="date-sep">→</span>
    <input type="date" id="filter-to" class="filter-date" title="Bitiş tarihi">
    <button id="filter-clear" class="filter-clear" title="Filtreleri temizle" hidden>✕</button>
  </div>
  <div id="filter-status" class="filter-status" hidden></div>

  <div id="session-list"></div>

  <script src="${jsUri}"></script>
</body>
</html>`;
  }

  /** Refreshes the panel data if it is currently open. */
  public static updateIfOpen(): void {
    if (SummaryPanel.currentPanel) {
      SummaryPanel.currentPanel._update();
    }
  }

  public dispose(): void {
    this._stopRefreshTimer();
    SummaryPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

/** Return "YYYY-MM-DD" for a local date. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Groups completed sessions by branch, plus the active session if it has commits.
 * Sorted by most recent session first. Sessions without a branch go last.
 */
function buildBranchGroups(
  sessions: import('../storage/logStorage').Session[],
  workspacePath: string
): BranchGroup[] {
  const completed = [...sessions].reverse().filter(s => s.endTime);
  const active = sessions.find(s => !s.endTime);

  // Collect all hashes from completed and active sessions for message resolution
  const allSources = active ? [...completed, active] : completed;
  if (allSources.length === 0) { return []; }

  const allHashes = [...new Set(allSources.flatMap(s => s.commits ?? []))];
  const msgMap = resolveCommitMessages(workspacePath, allHashes);

  const groupMap = new Map<string, BranchGroup>();

  for (const s of completed) {
    const key = s.branch ?? '';
    if (!groupMap.has(key)) {
      groupMap.set(key, { branch: key, totalSeconds: 0, sessionCount: 0, sessions: [] });
    }
    const group = groupMap.get(key)!;
    // Prefer activeSeconds (excludes idle) for accurate display
    group.totalSeconds += s.activeSeconds ?? s.duration ?? 0;
    group.sessionCount += 1;
    group.sessions.push({
      id: s.id,
      startTime: s.startTime,
      duration: s.activeSeconds ?? s.duration ?? 0,
      branch: s.branch,
      commits: (s.commits ?? []).map(hash => ({
        hash,
        short: hash.slice(0, 7),
        message: msgMap.get(hash) ?? '',
      })),
    });
  }

  // Include active session only if it has recorded commits
  if (active && (active.commits ?? []).length > 0) {
    const key = active.branch ?? '';
    if (!groupMap.has(key)) {
      groupMap.set(key, { branch: key, totalSeconds: 0, sessionCount: 0, sessions: [] });
    }
    const group = groupMap.get(key)!;
    group.sessions.unshift({
      id: active.id,
      startTime: active.startTime,
      duration: 0, // still in progress — don't add to totals
      branch: active.branch,
      commits: (active.commits ?? []).map(hash => ({
        hash,
        short: hash.slice(0, 7),
        message: msgMap.get(hash) ?? '',
      })),
    });
  }

  // Named branches sorted by most-recent session; unnamed group goes last
  return [...groupMap.values()].sort((a, b) => {
    if (a.branch === '' && b.branch !== '') { return 1; }
    if (a.branch !== '' && b.branch === '') { return -1; }
    return new Date(b.sessions[0].startTime).getTime() - new Date(a.sessions[0].startTime).getTime();
  });
}

/**
 * Calls `git log --no-walk` to get subject lines for the given hashes.
 * Returns empty map silently on any failure (no git, invalid hashes, etc.).
 */
function resolveCommitMessages(workspacePath: string, hashes: string[]): Map<string, string> {
  if (hashes.length === 0) { return new Map(); }
  try {
    const result = cp.spawnSync(
      'git',
      ['log', '--format=%H|%s', '--no-walk', ...hashes],
      { cwd: workspacePath, encoding: 'utf8', timeout: 3000 }
    );
    const map = new Map<string, string>();
    for (const line of (result.stdout ?? '').split('\n')) {
      const sep = line.indexOf('|');
      if (sep > 0) {
        map.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Computes Pomodoro-specific statistics from completed sessions. */
function buildPomodoroStats(
  sessions: import('../storage/logStorage').Session[],
  todayStr: string,
  weekStart: Date
): { pomodoroToday: number; pomodoroWeek: number; pomodoroTimeToday: number; pomodoroTimeWeek: number } {
  let pomodoroToday = 0;
  let pomodoroWeek = 0;
  let pomodoroTimeToday = 0;
  let pomodoroTimeWeek = 0;

  for (const s of sessions) {
    if (!s.endTime || s.source !== 'pomodoro') { continue; }
    const secs = s.duration || 0;
    const sessionDate = new Date(s.startTime);
    if (toDateStr(sessionDate) === todayStr) {
      pomodoroToday++;
      pomodoroTimeToday += secs;
    }
    if (sessionDate >= weekStart) {
      pomodoroWeek++;
      pomodoroTimeWeek += secs;
    }
  }

  return { pomodoroToday, pomodoroWeek, pomodoroTimeToday, pomodoroTimeWeek };
}
