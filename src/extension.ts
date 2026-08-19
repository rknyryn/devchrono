import * as vscode from 'vscode';
import * as fs from 'fs';
import { recoverOrphanSessions, getLogPath } from './storage/logStorage';
import { startSession, endSession, getStatusBarItem, resetAndRestart, updateStatusBar, recordCommit, resetStatusBarTimer, splitSession, notifyActivity, registerPomodoroStatusProvider } from './sessionManager';
import { SummaryPanel } from './views/summaryPanel';
import { QuickPanelProvider } from './views/quickPanel';
import { GitTimelinePanel } from './views/gitTimelinePanel';
import { createGitTracker } from './gitTracker';
import { createIdleDetector } from './idleDetector';
import { initPomodoro, startPomodoro, stopPomodoro, skipBreak, getPomodoroStatusText } from './pomodoroManager';
import { exportLogAsCsv } from './exportLog';

export function activate(context: vscode.ExtensionContext): void {
  // 1. Recover orphaned sessions from previous crashes
  recoverOrphanSessions();

  // 2. Start the new session
  startSession(context);

  // 3. Register the status bar item
  const statusBar = getStatusBarItem();
  if (statusBar) {
    context.subscriptions.push(statusBar);
  }

  // 3b. Register the QuickPanel WebviewView provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      QuickPanelProvider.viewType,
      new QuickPanelProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 4. Start git commit tracking — activate vscode.git first to guarantee it's
  //    ready regardless of extension activation order.
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    const workspacePath = folders[0].uri.fsPath;
    (async () => {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension && !gitExtension.isActive) {
        try { await gitExtension.activate(); } catch { /* ignore — fallback still works */ }
      }
      const tracker = createGitTracker(
        workspacePath,
        (hash) => { recordCommit(hash); },
        (newBranch) => { splitSession(newBranch); updateStatusBar(); SummaryPanel.updateIfOpen(); }
      );
      if (tracker) { context.subscriptions.push(tracker); }
    })();
  }

  // 5. Start idle detection
  const idleDetector = createIdleDetector(context, () => {
    notifyActivity();
    updateStatusBar();
  });
  context.subscriptions.push(idleDetector);

  // 6. Initialize Pomodoro module and wire status bar provider
  initPomodoro(context.extensionUri);
  registerPomodoroStatusProvider(getPomodoroStatusText);

  // 7. Update status bar on settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devchrono')) {
        resetStatusBarTimer();
        updateStatusBar();
      }
    })
  );

  // 8. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('devchrono.showSummary', () => {
      SummaryPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('devchrono.showQuickPanel', () => {
      vscode.commands.executeCommand('devchrono.quickPanelView.focus');
    }),

    vscode.commands.registerCommand('devchrono.showToday', () => {
      SummaryPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('devchrono.resetLog', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all DevChrono logs? This cannot be undone.',
        { modal: true },
        'Reset'
      );
      if (confirm === 'Reset') {
        const logPath = getLogPath();
        if (logPath) {
          try { fs.unlinkSync(logPath); } catch { /* ignore */ }
        }
        resetAndRestart(context);
      }
    }),

    vscode.commands.registerCommand('devchrono.showGitTimeline', () => {
      GitTimelinePanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('devchrono.startPomodoro', () => {
      startPomodoro(context);
      updateStatusBar();
      QuickPanelProvider.refresh();
    }),

    vscode.commands.registerCommand('devchrono.stopPomodoro', () => {
      stopPomodoro(context);
      updateStatusBar();
      QuickPanelProvider.refresh();
    }),

    vscode.commands.registerCommand('devchrono.skipBreak', () => {
      skipBreak(context);
      updateStatusBar();
      QuickPanelProvider.refresh();
    }),

    vscode.commands.registerCommand('devchrono.exportLog', () => {
      exportLogAsCsv();
    })
  );
}

export function deactivate(): void {
  endSession();
}
