import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as cp from 'child_process';
import { readLog, writeLog, createNewLog, getLogPath } from './storage/logStorage';
import { formatDuration } from './utlis/timeFormatter';
import type { Session, ProjectLog } from './storage/logStorage';

let currentSession: Session | undefined;
let currentLog: ProjectLog | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let statusBarTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

// Lazy import to avoid circular dependency — pomodoroManager imports sessionManager
let _getPomodoroStatusText: (() => string | undefined) | undefined;
export function registerPomodoroStatusProvider(fn: () => string | undefined): void {
  _getPomodoroStatusText = fn;
}
function getPomodoroStatusText(): string | undefined {
  return _getPomodoroStatusText?.();
}

// Idle detection state
let idleState: 'active' | 'idle' = 'active';
let lastActivityTime: number = Date.now();
let accumulatedIdleMs: number = 0;
let currentIdleStartTime: number | undefined;

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;  // 5 minutes
const STATUSBAR_INTERVAL_MIN = 60 * 1000;  // 1 minute (when showSeconds = false)

function getIdleTimeoutMs(): number {
  const enabled = vscode.workspace.getConfiguration('devchrono').get<boolean>('enableIdleDetection', true);
  if (!enabled) { return Infinity; }
  const minutes = vscode.workspace.getConfiguration('devchrono').get<number>('idleTimeoutMinutes', 10);
  return Math.max(1, minutes) * 60 * 1000;
}

function checkIdleTransition(): void {
  const now = Date.now();
  const idleTimeoutMs = getIdleTimeoutMs();
  const elapsed = now - lastActivityTime;

  if (idleState === 'active' && elapsed > idleTimeoutMs) {
    // Backdate: idle starts from when activity stopped + timeout (not from now)
    currentIdleStartTime = lastActivityTime + idleTimeoutMs;
    idleState = 'idle';
  } else if (idleState === 'idle' && elapsed <= idleTimeoutMs) {
    // Activity resumed — commit idle period
    if (currentIdleStartTime !== undefined) {
      accumulatedIdleMs += Math.max(0, now - currentIdleStartTime);
      currentIdleStartTime = undefined;
    }
    idleState = 'active';
  }
}

function getActiveElapsedSec(): number {
  if (!currentSession) { return 0; }
  checkIdleTransition();
  const rawMs = Date.now() - new Date(currentSession.startTime).getTime();
  const openIdleMs = (idleState === 'idle' && currentIdleStartTime !== undefined)
    ? Math.max(0, Date.now() - currentIdleStartTime)
    : 0;
  return Math.max(0, Math.floor((rawMs - accumulatedIdleMs - openIdleMs) / 1000));
}

/** Called by idleDetector on any VS Code activity signal. */
export function notifyActivity(): void {
  lastActivityTime = Date.now();
  checkIdleTransition();
}

export function startSession(context: vscode.ExtensionContext): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }

  // Reset idle state for this new session
  idleState = 'active';
  lastActivityTime = Date.now();
  accumulatedIdleMs = 0;
  currentIdleStartTime = undefined;

  const workspaceFolder = folders[0];
  const workspaceName = workspaceFolder.name;
  const workspacePath = workspaceFolder.uri.fsPath;

  currentLog = readLog() ?? createNewLog(workspaceName, workspacePath);

  currentSession = {
    id: crypto.randomUUID(),
    startTime: new Date().toISOString(),
    endTime: '',
    duration: 0,
    lastHeartbeat: '',
    recovered: false,
  };

  currentLog.sessions.push(currentSession);
  // Persist immediately so orphan recovery can find this session on crash
  writeLog(currentLog);

  // Resolve current git branch asynchronously — don't block activation.
  // Capture the session/log refs so a branch-split mid-flight doesn't corrupt
  // the wrong session (splitSession creates a new currentSession object).
  const capturedSession = currentSession;
  const capturedLog = currentLog;
  cp.execFile(
    'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: workspacePath, encoding: 'utf8', timeout: 2000 },
    (err, stdout) => {
      // Skip if already set by splitSession, or if refs are stale
      if (!err && capturedSession && capturedLog && !capturedSession.branch) {
        const raw = stdout.trim();
        capturedSession.branch = raw === 'HEAD' ? '(detached)' : raw;
        writeLog(capturedLog);
      }
    }
  );

  heartbeatTimer = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'devchrono.showQuickPanel';
  statusBarItem.tooltip = 'DevChrono — click to open summary';
  updateStatusBar();
  statusBarItem.show();

  resetStatusBarTimer();
}

/** Clears the existing status bar timer and restarts it based on the current `devchrono.showSeconds` setting. */
export function resetStatusBarTimer(): void {
  if (statusBarTimer) {
    clearTimeout(statusBarTimer);
    clearInterval(statusBarTimer);
    statusBarTimer = undefined;
  }

  const showSecs = vscode.workspace.getConfiguration('devchrono').get<boolean>('showSeconds', true);

  if (showSecs) {
    statusBarTimer = setInterval(updateStatusBar, 1000);
  } else {
    // Align first tick to the next clock minute so the display stays in sync with the system clock
    const msUntilNextMinute = STATUSBAR_INTERVAL_MIN - (Date.now() % STATUSBAR_INTERVAL_MIN);
    statusBarTimer = setTimeout(() => {
      updateStatusBar();
      statusBarTimer = setInterval(updateStatusBar, STATUSBAR_INTERVAL_MIN);
    }, msUntilNextMinute);
  }
}

export function endSession(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  if (statusBarTimer) {
    clearInterval(statusBarTimer);
    statusBarTimer = undefined;
  }

  if (currentSession && currentLog) {
    const endTime = new Date().toISOString();

    // Close any open idle period
    if (idleState === 'idle' && currentIdleStartTime !== undefined) {
      accumulatedIdleMs += Math.max(0, Date.now() - currentIdleStartTime);
      currentIdleStartTime = undefined;
    }

    currentSession.endTime = endTime;
    const totalElapsedSec = Math.max(0, Math.floor(
      (new Date(endTime).getTime() - new Date(currentSession.startTime).getTime()) / 1000
    ));
    const idleSec = Math.floor(accumulatedIdleMs / 1000);
    currentSession.duration = totalElapsedSec;
    currentSession.idleSeconds = idleSec;
    currentSession.activeSeconds = Math.max(0, totalElapsedSec - idleSec);
    writeLog(currentLog);
  }

  statusBarItem?.dispose();
  statusBarItem = undefined;
  currentSession = undefined;
  currentLog = undefined;
}

export function updateHeartbeat(): void {
  if (!currentSession || !currentLog) {
    return;
  }
  checkIdleTransition(); // keep state current between status bar ticks
  currentSession.lastHeartbeat = new Date().toISOString();
  writeLog(currentLog);
}

/** Tags the currently active session with a source identifier (e.g. 'pomodoro'). */
export function tagCurrentSession(source: 'pomodoro'): void {
  if (!currentSession || !currentLog) { return; }
  currentSession.source = source;
  writeLog(currentLog);
}

/** Returns total seconds across all completed sessions plus the current in-progress time. */
export function getTotalTime(): number {
  if (!currentLog) {
    return 0;
  }

  let total = 0;
  for (const session of currentLog.sessions) {
    if (session === currentSession) {
      total += getActiveElapsedSec();
    } else if (session.endTime) {
      // Use activeSeconds when available (v3+); fall back to duration for old sessions
      total += session.activeSeconds ?? session.duration ?? 0;
    }
  }

  return total;
}

/** Returns total seconds for sessions that started today (local date). */
export function getTodayTime(): number {
  if (!currentLog) { return 0; }
  const todayStr = toLocalDateStr(new Date());
  let total = 0;
  for (const session of currentLog.sessions) {
    if (toLocalDateStr(new Date(session.startTime)) !== todayStr) { continue; }
    if (session === currentSession) {
      total += getActiveElapsedSec();
    } else if (session.endTime) {
      total += session.activeSeconds ?? session.duration ?? 0;
    }
  }
  return total;
}

/** Returns elapsed seconds for the current in-progress session only. */
export function getCurrentSessionTime(): number {
  if (!currentSession) { return 0; }
  return getActiveElapsedSec();
}

/** Returns "YYYY-MM-DD" using local timezone. */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function updateStatusBar(): void {
  if (!statusBarItem) { return; }

  // Pomodoro takes priority over standard display
  const pomodoroText = getPomodoroStatusText();
  if (pomodoroText !== undefined) {
    statusBarItem.text = pomodoroText;
    return;
  }

  // Standard display
  const mode = vscode.workspace.getConfiguration('devchrono').get<string>('statusBarMode', 'total');
  let label: string;
  let seconds: number;
  switch (mode) {
    case 'today':
      label = 'Bugün';
      seconds = getTodayTime();
      break;
    case 'session':
      label = 'Oturum';
      seconds = getCurrentSessionTime();
      break;
    default:
      label = 'Toplam';
      seconds = getTotalTime();
  }
  const showSecs = vscode.workspace.getConfiguration('devchrono').get<boolean>('showSeconds', true);
  const icon = idleState === 'idle' ? '⏸' : '⏱';
  statusBarItem.text = `${icon} ${label}: ${formatDuration(seconds, showSecs)}`;
}

export function getStatusBarItem(): vscode.StatusBarItem | undefined {
  return statusBarItem;
}

/** Records a commit hash to the current in-progress session (idempotent). */
export function recordCommit(hash: string): void {
  if (!currentSession || !currentLog) { return; }
  if (!currentSession.commits) { currentSession.commits = []; }
  if (currentSession.commits.includes(hash)) { return; }
  currentSession.commits.push(hash);
  writeLog(currentLog);
}

/**
 * Ends the current session and starts a fresh one tagged with `newBranch`.
 * Called automatically when a branch switch is detected mid-session.
 * Timers and the status bar item are intentionally left running.
 */
export function splitSession(newBranch: string): void {
  if (!currentSession || !currentLog) { return; }

  const endTime = new Date().toISOString();

  // Close any open idle period for the closing session
  if (idleState === 'idle' && currentIdleStartTime !== undefined) {
    accumulatedIdleMs += Math.max(0, new Date(endTime).getTime() - currentIdleStartTime);
    currentIdleStartTime = undefined;
  }

  const totalElapsedSec = Math.max(0, Math.floor(
    (new Date(endTime).getTime() - new Date(currentSession.startTime).getTime()) / 1000
  ));
  const idleSec = Math.floor(accumulatedIdleMs / 1000);
  currentSession.endTime = endTime;
  currentSession.duration = totalElapsedSec;
  currentSession.idleSeconds = idleSec;
  currentSession.activeSeconds = Math.max(0, totalElapsedSec - idleSec);

  // Reset idle state for the new session
  idleState = 'active';
  lastActivityTime = Date.now();
  accumulatedIdleMs = 0;
  currentIdleStartTime = undefined;

  currentSession = {
    id: crypto.randomUUID(),
    startTime: new Date().toISOString(),
    endTime: '',
    duration: 0,
    lastHeartbeat: '',
    recovered: false,
    branch: newBranch,
  };

  currentLog.sessions.push(currentSession);
  writeLog(currentLog);
}

/** Clears all session state and log — used by the reset command. */
export function resetAndRestart(context: vscode.ExtensionContext): void {
  endSession();
  startSession(context);
}
