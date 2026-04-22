import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { Store } from '../state/store';

export class DashboardPanel {
  static currentPanel: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private unsubscribe: (() => void) | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  static createOrShow(context: vscode.ExtensionContext, store: Store): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      DashboardPanel.currentPanel.postState(store);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentTracker.dashboard',
      'Agent Usage',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
        retainContextWhenHidden: true,
      }
    );
    DashboardPanel.currentPanel = new DashboardPanel(panel, context.extensionUri, store, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    store: Store,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtml(store);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string; agent?: string; sessionId?: string }) => {
        if (msg.type === 'requestState') {
          this.postState(store);
        } else if (msg.type === 'resetSession') {
          vscode.commands.executeCommand('agentTracker.resetSession', msg.agent);
        } else if (msg.type === 'snoozeWarning') {
          vscode.commands.executeCommand('agentTracker.snoozeWarning', msg.sessionId);
        }
      },
      undefined,
      context.subscriptions
    );

    this.unsubscribe = store.onDidChange(() => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.postState(store), 250);
    });

    this.panel.onDidDispose(() => {
      this.unsubscribe?.();
      clearTimeout(this.debounceTimer);
      DashboardPanel.currentPanel = undefined;
    }, undefined, context.subscriptions);
  }

  private postState(store: Store): void {
    void this.panel.webview.postMessage({ type: 'stateUpdate', payload: JSON.parse(store.serialize()) });
  }

  private getHtml(store: Store): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const webview = this.panel.webview;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.css')
    );
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const initialState = JSON.stringify(JSON.parse(store.serialize()));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <title>Agent Usage</title>
  <link rel="stylesheet" href="${cssUri}"/>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__initialState__ = ${initialState};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
