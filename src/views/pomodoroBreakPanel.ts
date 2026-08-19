import * as vscode from 'vscode';

export class PomodoroBreakPanel {
  public static currentPanel: PomodoroBreakPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _totalSeconds: number;
  private readonly _onSkip: () => void;
  private _disposables: vscode.Disposable[] = [];

  public static show(
    extensionUri: vscode.Uri,
    remainingSeconds: number,
    totalSeconds: number,
    onSkip: () => void
  ): void {
    if (PomodoroBreakPanel.currentPanel) {
      PomodoroBreakPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      PomodoroBreakPanel.currentPanel._postState(remainingSeconds, totalSeconds);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'devchronoPomodoroBreak',
      'Mola Zamanı',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    PomodoroBreakPanel.currentPanel = new PomodoroBreakPanel(
      panel,
      extensionUri,
      remainingSeconds,
      totalSeconds,
      onSkip
    );
  }

  public static update(remainingSeconds: number): void {
    if (!PomodoroBreakPanel.currentPanel) { return; }
    const p = PomodoroBreakPanel.currentPanel;
    p._postState(remainingSeconds, p._totalSeconds);
  }

  public static dispose(): void {
    const target = PomodoroBreakPanel.currentPanel;
    if (!target) { return; }
    // Clear currentPanel first to prevent the onDidDispose handler from
    // re-creating the panel (natural break-end path, not user dismiss).
    PomodoroBreakPanel.currentPanel = undefined;
    target._panel.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private _remainingSeconds: number,
    totalSeconds: number,
    onSkip: () => void
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._totalSeconds = totalSeconds;
    this._onSkip = onSkip;

    this._panel.webview.html = this._getHtmlForWebview(panel.webview);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === 'ready') {
          this._postState(this._remainingSeconds, this._totalSeconds);
        } else if (message.type === 'skipBreak') {
          this._onSkip();
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(
      () => {
        // Only re-create or clean up if currentPanel still points to this instance
        // (i.e. not a programmatic dispose() call which cleared it first).
        if (PomodoroBreakPanel.currentPanel === this) {
          PomodoroBreakPanel.currentPanel = undefined;
          const enforcement = vscode.workspace
            .getConfiguration('devchrono.pomodoro')
            .get<string>('breakEnforcement', 'persistent');
          if (enforcement === 'persistent') {
            PomodoroBreakPanel.show(
              this._extensionUri,
              this._remainingSeconds,
              this._totalSeconds,
              this._onSkip
            );
          } else {
            this._onSkip();
          }
        }
        this._cleanup();
      },
      null,
      this._disposables
    );

    this._panel.onDidChangeViewState(
      (e) => {
        if (!e.webviewPanel.visible) {
          const enforcement = vscode.workspace
            .getConfiguration('devchrono.pomodoro')
            .get<string>('breakEnforcement', 'persistent');
          if (enforcement === 'persistent') {
            this._panel.reveal(vscode.ViewColumn.One);
          }
        }
      },
      null,
      this._disposables
    );
  }

  private _postState(remainingSeconds: number, totalSeconds: number): void {
    this._remainingSeconds = remainingSeconds;
    this._panel.webview.postMessage({ type: 'pomodoroState', remainingSeconds, totalSeconds });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'pomodoro-break.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'pomodoro-break.js')
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
  <title>Mola Zamanı</title>
</head>
<body>
  <div class="break-container">
    <div class="break-icon">☕</div>
    <h1 class="break-title">Mola Zamanı!</h1>
    <p class="break-subtitle">Gözlerini dinlendir, biraz uzaklaş.</p>
    <div class="countdown" id="countdown">--:--</div>
    <div class="progress-bar">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
    <button class="skip-btn" id="skip-btn">Molayı Atla →</button>
  </div>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }

  private _cleanup(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}
