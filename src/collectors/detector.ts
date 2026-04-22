import * as vscode from 'vscode';
import { createClaudeCollector } from './claude';
import { createCodexCollector } from './codex';
import type { Store } from '../state/store';

export function startAllCollectors(
  store: Store,
  context: vscode.ExtensionContext,
  outChannel: vscode.OutputChannel
): void {
  const claude = createClaudeCollector();
  const codex = createCodexCollector();

  claude.start(store, outChannel, context);
  codex.start(store, outChannel, context);

  context.subscriptions.push({ dispose: () => claude.stop() });
  context.subscriptions.push({ dispose: () => codex.stop() });

  // Persist state every 30 seconds
  const persistInterval = setInterval(() => {
    context.globalState.update('agentTrackerState', store.serialize());
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(persistInterval) });

  // Persist immediately on workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      context.globalState.update('agentTrackerState', store.serialize());
    })
  );
}
