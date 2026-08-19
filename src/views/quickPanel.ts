import * as vscode from 'vscode';
import { readLog } from '../storage/logStorage';
import { isPomodoroActive, getPomodoroStatusText, getPomodoroTimingInfo } from '../pomodoroManager';

const TR_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

interface QuickPanelData {
  projectName: string;
  total: number;              // all-time completed seconds
  todayCompleted: number;     // seconds from completed sessions today
  weekCompleted: number;      // seconds from completed sessions this week
  monthCompleted: number;     // seconds from completed sessions this month
  last7Days: Array<{ label: string; seconds: number; isToday: boolean }>;
  sessionStartMs: number | null; // Unix ms timestamp of active session start
  pomodoroPhase: 'idle' | 'work' | 'break';
  pomodoroPhaseStartMs: number | null; // Unix ms timestamp when current phase started
  pomodoroPhaseTotalMs: number;        // total duration of current phase in ms
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class QuickPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devchrono.quickPanelView';

  private static _instance: QuickPanelProvider | undefined;
  private _view?: vscode.WebviewView;
  private _refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {
    QuickPanelProvider._instance = this;
  }

  public static refresh(): void {
    QuickPanelProvider._instance?._update();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => this._handleMessage(msg));

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._update();
        this._startRefreshTimer();
      } else {
        this._stopRefreshTimer();
      }
    });
  }

  private _handleMessage(message: { type?: string; command?: string }): void {
    if (message.type === 'ready') {
      this._update();
      this._startRefreshTimer();
      return;
    }

    switch (message.command) {
      case 'startPomodoro':
        vscode.commands.executeCommand('devchrono.startPomodoro').then(() => this._update());
        break;
      case 'stopPomodoro':
        vscode.commands.executeCommand('devchrono.stopPomodoro').then(() => this._update());
        break;
      case 'skipBreak':
        vscode.commands.executeCommand('devchrono.skipBreak').then(() => this._update());
        break;
      case 'showSummary':
        vscode.commands.executeCommand('devchrono.showSummary');
        break;
    }
  }

  private _startRefreshTimer(): void {
    if (this._refreshTimer !== undefined) { return; }
    this._refreshTimer = setInterval(() => this._update(), 15_000);
  }

  private _stopRefreshTimer(): void {
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  private _update(): void {
    if (!this._view) { return; }

    const folders = vscode.workspace.workspaceFolders;
    const log = folders && folders.length > 0 ? readLog(folders[0].uri.fsPath) : null;

    const now = new Date();
    const todayStr = toDateStr(now);

    const weekStart = new Date(now);
    const dayOfWeek = weekStart.getDay();
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    weekStart.setDate(weekStart.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = 0;
    let todayCompleted = 0;
    let weekCompleted = 0;
    let monthCompleted = 0;
    let sessionStartMs: number | null = null;

    if (log) {
      const activeSession = log.sessions.find(s => !s.endTime);
      if (activeSession) {
        sessionStartMs = new Date(activeSession.startTime).getTime();
      }
      for (const session of log.sessions) {
        if (!session.endTime) { continue; } // skip active — client counts live
        const secs = session.duration || 0;
        total += secs;
        const sessionDate = new Date(session.startTime);
        if (toDateStr(sessionDate) === todayStr) { todayCompleted += secs; }
        if (sessionDate >= weekStart) { weekCompleted += secs; }
        if (sessionDate >= monthStart) { monthCompleted += secs; }
      }
    }

    // Build last-7-days chart data (today first)
    const last7Days: Array<{ label: string; seconds: number; isToday: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dateStr = toDateStr(d);
      const dayLabel = `${TR_DAYS[d.getDay()]} ${d.getDate()} ${TR_MONTHS[d.getMonth()]}`;
      const daySeconds = log
        ? log.sessions
            .filter(s => toDateStr(new Date(s.startTime)) === dateStr)
            .reduce((acc, s) => acc + (s.endTime ? (s.duration || 0) : Math.floor((Date.now() - new Date(s.startTime).getTime()) / 1000)), 0)
        : 0;
      last7Days.push({ label: dayLabel, seconds: daySeconds, isToday: i === 0 });
    }

    const pomodoroPhase = isPomodoroActive()
      ? (getPomodoroStatusText()?.startsWith('☕') ? 'break' : 'work')
      : 'idle';
    const timing = getPomodoroTimingInfo();

    const data: QuickPanelData = {
      projectName: log?.projectName ?? 'DevChrono',
      total,
      todayCompleted,
      weekCompleted,
      monthCompleted,
      last7Days,
      sessionStartMs,
      pomodoroPhase: pomodoroPhase as 'idle' | 'work' | 'break',
      pomodoroPhaseStartMs: timing?.phaseStartTime ?? null,
      pomodoroPhaseTotalMs: timing?.phaseTotalMs ?? 0,
    };

    this._view.webview.postMessage({ type: 'update', data });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'quick-panel.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'quick-panel.js')
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
  <title>DevChrono</title>
</head>
<body>
  <div class="header">
    <span class="header-icon">⏱</span>
    <span class="header-title" id="project-name">DevChrono</span>
  </div>

  <div class="stats-row">
    <div class="stat-card" data-accent="purple">
      <div class="stat-label">Toplam Süre</div>
      <div class="stat-value" id="stat-total">—</div>
    </div>
    <div class="stat-card" data-accent="orange">
      <div class="stat-label">Bu Ay</div>
      <div class="stat-value" id="stat-month">—</div>
    </div>
    <div class="stat-card" data-accent="green">
      <div class="stat-label">Bu Hafta</div>
      <div class="stat-value" id="stat-week">—</div>
    </div>
    <div class="stat-card" data-accent="blue">
      <div class="stat-label">Bugün</div>
      <div class="stat-value" id="stat-today">—</div>
    </div>
    <div class="stat-card" data-accent="yellow">
      <div class="stat-label">Şu An</div>
      <div class="stat-value" id="stat-session">—</div>
    </div>
  </div>

  <div class="seven-days-section">
    <div class="section-label">📅 Son 7 Gün</div>
    <div id="mini-chart"><div class="mini-empty">Yükleniyor…</div></div>
  </div>

  <div class="pomodoro-section">
    <div class="pomodoro-section-label">🍅 Pomodoro</div>
    <div class="pomodoro-timer" id="pomodoro-timer"></div>
    <div class="pomodoro-buttons" id="pomodoro-buttons"></div>
  </div>

  <div class="footer">
    <button class="summary-btn" id="btn-summary">
      <span>📊 Detaylı Özet</span>
      <span class="summary-btn-arrow">›</span>
    </button>
  </div>

  <script src="${jsUri}"></script>
</body>
</html>`;
  }
}
