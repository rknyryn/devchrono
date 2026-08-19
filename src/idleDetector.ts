import * as vscode from 'vscode';

/**
 * Subscribes to VS Code activity signals and calls onActivity() whenever
 * the developer is actively working. Returns a Disposable.
 */
export function createIdleDetector(
  context: vscode.ExtensionContext,
  onActivity: () => void
): vscode.Disposable {
  const debouncers = new Map<string, NodeJS.Timeout>();

  function debounced(key: string, delayMs: number, fn: () => void): void {
    const existing = debouncers.get(key);
    if (existing) { clearTimeout(existing); }
    debouncers.set(key, setTimeout(() => { debouncers.delete(key); fn(); }, delayMs));
  }

  const subs: vscode.Disposable[] = [
    // STRONG signals — no debounce
    vscode.workspace.onDidChangeTextDocument(() => onActivity()),
    vscode.workspace.onDidSaveTextDocument(() => onActivity()),
    vscode.debug.onDidStartDebugSession(() => onActivity()),
    vscode.tasks.onDidStartTask(() => onActivity()),

    // MEDIUM signals — debounce 2000ms
    vscode.window.onDidChangeTextEditorSelection(() => debounced('selection', 2000, onActivity)),
    vscode.window.onDidChangeActiveTextEditor(() => debounced('editor', 2000, onActivity)),
    vscode.window.onDidChangeVisibleTextEditors(() => debounced('visible', 2000, onActivity)),

    // Terminal signals — debounce 1000ms (stable public APIs only)
    vscode.window.onDidOpenTerminal(() => debounced('terminal', 1000, onActivity)),
    vscode.window.onDidChangeActiveTerminal(() => debounced('terminal', 1000, onActivity)),
  ];

  return vscode.Disposable.from(...subs);
}
