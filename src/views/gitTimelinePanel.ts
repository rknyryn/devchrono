import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { readLog } from '../storage/logStorage';

interface TimelineEntry {
  hash: string;
  short: string;
  message: string;
  authorDate: string;    // ISO 8601 — from git, used for sorting & display
  sessionDuration: number;  // seconds — full session that contained this commit
  sessionStart: string;     // ISO 8601 — session start, fallback sort key
}

interface TimelineData {
  projectName: string;
  entries: TimelineEntry[];
  hasGit: boolean;
}

export class GitTimelinePanel {
  public static currentPanel: GitTimelinePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GitTimelinePanel.currentPanel) {
      GitTimelinePanel.currentPanel._panel.reveal(column);
      GitTimelinePanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'devchronoGitTimeline',
      'DevChrono — Git Zaman Çizelgesi',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    GitTimelinePanel.currentPanel = new GitTimelinePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(panel.webview);
    // Wait for the webview script to signal it's ready before posting data.
    this._panel.webview.onDidReceiveMessage(
      (message) => { if (message.type === 'ready') { this._update(); } },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(
      e => { if (e.webviewPanel.visible) { this._update(); } },
      null,
      this._disposables
    );
  }

  private _update(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this._panel.webview.postMessage({
        type: 'update',
        data: { projectName: 'DevChrono', entries: [], hasGit: false } as TimelineData,
      });
      return;
    }

    const workspacePath = folders[0].uri.fsPath;
    const hasGit = fs.existsSync(path.join(workspacePath, '.git'));
    const log = readLog(workspacePath);

    if (!log || !hasGit) {
      this._panel.webview.postMessage({
        type: 'update',
        data: { projectName: log?.projectName ?? 'DevChrono', entries: [], hasGit } as TimelineData,
      });
      return;
    }

    this._panel.webview.postMessage({
      type: 'update',
      data: buildTimelineData(log, workspacePath),
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'timeline.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'timeline.js')
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
  <title>DevChrono — Git Zaman Çizelgesi</title>
</head>
<body>
  <div class="panel-header">
    <div>
      <h1>⏱ DevChrono — <span id="project-name">…</span></h1>
      <p class="subtitle">Git Zaman Çizelgesi</p>
    </div>
  </div>
  <div id="content"><div class="loading">Yükleniyor…</div></div>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    GitTimelinePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

/**
 * Collects all commits across completed sessions and resolves their git metadata.
 * Commits appearing in multiple sessions use the most recent session's duration.
 */
function buildTimelineData(
  log: import('../storage/logStorage').ProjectLog,
  workspacePath: string
): TimelineData {
  // commitToSession maps hash → session info (newest session wins on duplicate)
  const commitToSession = new Map<string, { duration: number; sessionStart: string }>();

  // Process newest sessions first so earlier entries in the map are the most recent
  const completedWithCommits = log.sessions
    .filter(s => s.endTime && s.commits && s.commits.length > 0)
    .slice()
    .reverse();

  for (const session of completedWithCommits) {
    for (const hash of session.commits!) {
      if (!commitToSession.has(hash)) {
        commitToSession.set(hash, {
          duration: session.duration,
          sessionStart: session.startTime,
        });
      }
    }
  }

  if (commitToSession.size === 0) {
    return { projectName: log.projectName, entries: [], hasGit: true };
  }

  const hashes = [...commitToSession.keys()];
  const gitInfo = resolveCommitInfo(workspacePath, hashes);

  const entries: TimelineEntry[] = [];
  for (const [hash, sessionData] of commitToSession) {
    const info = gitInfo.get(hash);
    entries.push({
      hash,
      short: hash.slice(0, 7),
      message: info?.message ?? '',
      authorDate: info?.authorDate ?? '',
      sessionDuration: sessionData.duration,
      sessionStart: sessionData.sessionStart,
    });
  }

  // Sort newest commit first; fall back to sessionStart when authorDate is missing
  entries.sort((a, b) => {
    const da = a.authorDate || a.sessionStart;
    const db = b.authorDate || b.sessionStart;
    return db.localeCompare(da);
  });

  return { projectName: log.projectName, entries, hasGit: true };
}

interface GitCommitInfo {
  message: string;
  authorDate: string;
}

/**
 * Batch-fetches commit subject + author date for the given hashes.
 * Uses `git log --no-walk` which does not traverse history — fast even in large repos.
 * Format: %H|%aI|%s  (hash | ISO date | subject)
 * The subject may contain '|', so we find the first two separators only.
 */
function resolveCommitInfo(workspacePath: string, hashes: string[]): Map<string, GitCommitInfo> {
  if (hashes.length === 0) { return new Map(); }
  try {
    const result = cp.spawnSync(
      'git',
      ['log', '--format=%H|%aI|%s', '--no-walk', ...hashes],
      { cwd: workspacePath, encoding: 'utf8', timeout: 5000 }
    );
    const map = new Map<string, GitCommitInfo>();
    for (const line of (result.stdout ?? '').split('\n')) {
      const i1 = line.indexOf('|');
      if (i1 < 0) { continue; }
      const i2 = line.indexOf('|', i1 + 1);
      if (i2 < 0) { continue; }
      const hash = line.slice(0, i1).trim();
      const authorDate = line.slice(i1 + 1, i2).trim();
      const message = line.slice(i2 + 1).trim();
      if (hash) {
        map.set(hash, { message, authorDate });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}
