import * as vscode from 'vscode';
import { PomodoroBreakPanel } from './views/pomodoroBreakPanel';
import { startSession, endSession, tagCurrentSession } from './sessionManager';

type PomodoroPhase = 'idle' | 'work' | 'break';

interface PomodoroState {
  phase: PomodoroPhase;
  phaseStartTime: number;   // Date.now() — wall clock anchor
  workDurationMs: number;   // from config, default 25*60*1000
  breakDurationMs: number;  // from config, default 5*60*1000
}

let state: PomodoroState | undefined;
let phaseTimer: NodeJS.Timeout | undefined;
let extensionUri: vscode.Uri | undefined;

/** Call once from extension.ts activate() to store extensionUri */
export function initPomodoro(uri: vscode.Uri): void {
  extensionUri = uri;
}

/** Start Pomodoro — begins work phase, starts a DevChrono session */
export function startPomodoro(context: vscode.ExtensionContext): void {
  try {
    if (state && state.phase !== 'idle') {
      return; // already running
    }
    startWorkPhase(context);
  } catch {
    // never crash the extension
  }
}

/** Stop Pomodoro — cancels current cycle, returns to passive tracking */
export function stopPomodoro(context: vscode.ExtensionContext): void {
  try {
    clearTimer();

    if (state?.phase === 'work') {
      endSession();
    } else if (state?.phase === 'break') {
      PomodoroBreakPanel.dispose();
    }

    state = undefined;

    // Resume passive tracking
    startSession(context);
  } catch {
    // never crash the extension
  }
}

/** Skip the current break — end break early, start next work phase */
export function skipBreak(context: vscode.ExtensionContext): void {
  try {
    if (!state || state.phase !== 'break') { return; }
    clearTimer();
    PomodoroBreakPanel.dispose();
    startWorkPhase(context);
  } catch {
    // never crash the extension
  }
}

/**
 * Returns display text for the status bar if Pomodoro is active.
 * Returns undefined when Pomodoro is idle.
 * Format:
 *   work phase:  "🍅 18:32"
 *   break phase: "☕ 4:11"
 */
export function getPomodoroStatusText(): string | undefined {
  if (!state || state.phase === 'idle') { return undefined; }
  const elapsed = Date.now() - state.phaseStartTime;
  const totalMs = state.phase === 'work' ? state.workDurationMs : state.breakDurationMs;
  const remainingMs = Math.max(0, totalMs - elapsed);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  const timeStr = `${min}:${String(sec).padStart(2, '0')}`;
  return state.phase === 'work' ? `🍅 ${timeStr}` : `☕ ${timeStr}`;
}

/** True if Pomodoro is currently active (work or break phase) */
export function isPomodoroActive(): boolean {
  return !!state && state.phase !== 'idle';
}

/** Returns wall-clock timing for the current phase, for client-side live countdown. */
export function getPomodoroTimingInfo(): { phaseStartTime: number; phaseTotalMs: number } | null {
  if (!state || state.phase === 'idle') { return null; }
  const phaseTotalMs = state.phase === 'work' ? state.workDurationMs : state.breakDurationMs;
  return { phaseStartTime: state.phaseStartTime, phaseTotalMs };
}

function startWorkPhase(context: vscode.ExtensionContext): void {
  try {
    const workMin = vscode.workspace.getConfiguration('devchrono').get<number>('pomodoro.workMinutes', 25);
    const breakMin = vscode.workspace.getConfiguration('devchrono').get<number>('pomodoro.breakMinutes', 5);

    state = {
      phase: 'work',
      phaseStartTime: Date.now(),
      workDurationMs: workMin * 60000,
      breakDurationMs: breakMin * 60000,
    };

    // End any currently active session (passive tracking or previous pomodoro phase)
    // before starting the new work-phase session. endSession() is idempotent.
    endSession();
    startSession(context);
    tagCurrentSession('pomodoro');

    clearTimer();
    phaseTimer = setTimeout(() => startBreakPhase(context), workMin * 60000);
  } catch {
    // never crash the extension
  }
}

function startBreakPhase(context: vscode.ExtensionContext): void {
  try {
    endSession();

    if (!state) { return; }
    // Re-read from config so changes made during the work phase take effect
    const breakMin = vscode.workspace.getConfiguration('devchrono').get<number>('pomodoro.breakMinutes', 5);
    const breakMs = breakMin * 60000;
    state = { ...state, phase: 'break', phaseStartTime: Date.now(), breakDurationMs: breakMs };

    const breakSec = Math.round(breakMs / 1000);
    if (extensionUri) {
      PomodoroBreakPanel.show(extensionUri, breakSec, breakSec, () => skipBreak(context));
    }

    clearTimer();
    phaseTimer = setTimeout(() => {
      try {
        PomodoroBreakPanel.dispose();
        startWorkPhase(context);
      } catch {
        // never crash the extension
      }
    }, breakMs);
  } catch {
    // never crash the extension
  }
}

function clearTimer(): void {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = undefined;
  }
}
