import * as vscode from 'vscode';
import { startAllCollectors } from './collectors/detector';
import { Store } from './state/store';
import { recordPrompt, resetSession } from './state/sessions';
import { createStatusBar } from './ui/statusBar';
import { SummaryProvider } from './ui/tree/summaryProvider';
import { RecentProvider } from './ui/tree/recentProvider';
import { DashboardPanel } from './webview/panel';
import type { Agent } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const outChannel = vscode.window.createOutputChannel('Agent Tracker');
  context.subscriptions.push(outChannel);

  const store = new Store();
  store.hydrate(context.globalState.get<string>('agentTrackerState', ''));

  // Sync settings from VS Code configuration into the store
  syncSettings(store);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentTracker')) {
        syncSettings(store);
      }
    })
  );

  startAllCollectors(store, context, outChannel);

  const statusBar = createStatusBar(store, context);
  context.subscriptions.push(statusBar);

  vscode.window.registerTreeDataProvider('agentTracker.summary', new SummaryProvider(store));
  vscode.window.registerTreeDataProvider('agentTracker.recent', new RecentProvider(store));

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTracker.openDashboard', () => {
      DashboardPanel.createOrShow(context, store);
    }),

    vscode.commands.registerCommand('agentTracker.newSession', () => {
      const agent: Agent = 'claude';
      resetSession(agent, store);
      vscode.window.showInformationMessage('Agent Tracker: started new Claude session.');
    }),

    vscode.commands.registerCommand('agentTracker.resetSession', (agent?: Agent) => {
      const target = agent ?? 'claude';
      resetSession(target, store);
    }),

    vscode.commands.registerCommand('agentTracker.snoozeWarning', (_sessionId?: string) => {
      // Placeholder: snooze just dismisses the alert visually for now
      vscode.window.showInformationMessage('Agent Tracker: context warning snoozed.');
    }),

    vscode.commands.registerCommand('agentTracker.recordPrompt', (agent?: Agent) => {
      const target = agent ?? 'claude';
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      recordPrompt(target, store, workspace);
      outChannel.appendLine(`Manual prompt recorded for ${target}`);
    })
  );

  outChannel.appendLine('Agent Tracker activated.');
}

export function deactivate(): void {
  // context.subscriptions disposes all registered disposables automatically.
  // No async work here — globalState is persisted by the 30s interval in detector.ts.
}

function syncSettings(store: Store): void {
  const cfg = vscode.workspace.getConfiguration('agentTracker');
  store.settings = {
    max5h: cfg.get<number>('max5h', 40),
    max7d: cfg.get<number>('max7d', 200),
    contextThresholds: {
      busy: cfg.get<number>('contextThresholds.busy', 50),
      heavy: cfg.get<number>('contextThresholds.heavy', 70),
      bloated: cfg.get<number>('contextThresholds.bloated', 85),
    },
    inactivityTimeoutMinutes: cfg.get<number>('inactivityTimeoutMinutes', 30),
  };
}
