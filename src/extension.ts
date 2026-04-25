import * as vscode from 'vscode';
import { startAllCollectors } from './collectors/detector';
import { Store } from './state/store';
import { incrementFilesTouched, recordPrompt, resetSession, startFreshSession } from './state/sessions';
import { createStatusBar } from './ui/statusBar';
import { SummaryProvider } from './ui/tree/summaryProvider';
import { RecentProvider } from './ui/tree/recentProvider';
import { DashboardPanel } from './webview/panel';
import type { Agent } from './types';

const AGENTS: Agent[] = ['claude', 'codex'];

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

  const seenFilesBySession = new Map<string, Set<string>>();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      const filePath = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : '';
      if (!filePath) {
        return;
      }

      const activeSessions = AGENTS
        .map(agent => store.getActiveSession(agent))
        .filter((session): session is NonNullable<typeof session> => session !== undefined);
      if (activeSessions.length === 0) {
        return;
      }

      const mostRecentSession = [...activeSessions].sort((a, b) => b.lastActivity - a.lastActivity)[0];
      const seenFiles = seenFilesBySession.get(mostRecentSession.id) ?? new Set<string>();
      if (seenFiles.has(filePath)) {
        return;
      }

      seenFiles.add(filePath);
      seenFilesBySession.set(mostRecentSession.id, seenFiles);
      incrementFilesTouched(mostRecentSession.agent, store);
    })
  );

  const statusBar = createStatusBar(store, context);
  context.subscriptions.push(statusBar);

  vscode.window.registerTreeDataProvider('agentTracker.summary', new SummaryProvider(store));
  vscode.window.registerTreeDataProvider('agentTracker.recent', new RecentProvider(store));

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTracker.openDashboard', () => {
      DashboardPanel.createOrShow(context, store);
    }),

    vscode.commands.registerCommand('agentTracker.newSession', async (agent?: Agent) => {
      const target = await selectAgent(agent, 'Start a new session for which agent?');
      if (!target) {
        return;
      }
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      startFreshSession(target, workspace, store);
      const agentLabel = target === 'claude' ? 'Claude' : 'Codex';
      vscode.window.showInformationMessage(`Agent Tracker: started new ${agentLabel} session.`);
    }),

    vscode.commands.registerCommand('agentTracker.resetSession', async (agent?: Agent) => {
      const activeAgents = AGENTS.filter(candidate => store.getActiveSession(candidate));
      const target = await selectAgent(
        agent,
        'Reset the current session for which agent?',
        activeAgents.length > 0 ? activeAgents : AGENTS
      );
      if (!target) {
        return;
      }
      resetSession(target, store);
    }),

    vscode.commands.registerCommand('agentTracker.snoozeWarning', (sessionId?: string) => {
      const targetId = sessionId ?? AGENTS
        .map(agent => store.getActiveSession(agent))
        .find(session => session?.contextState === 'heavy' || session?.contextState === 'bloated')
        ?.id;

      if (!targetId) {
        vscode.window.showInformationMessage('Agent Tracker: no heavy or bloated session to snooze.');
        return;
      }

      const isSnoozed = store.toggleSessionSnooze(targetId);
      vscode.window.showInformationMessage(
        isSnoozed
          ? 'Agent Tracker: context warning snoozed.'
          : 'Agent Tracker: context warning restored.'
      );
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

async function selectAgent(
  agent: Agent | undefined,
  placeHolder: string,
  candidates: Agent[] = AGENTS
): Promise<Agent | undefined> {
  if (agent) {
    return agent;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const selection = await vscode.window.showQuickPick(
    candidates.map(candidate => ({
      label: candidate === 'claude' ? 'Claude' : 'Codex',
      agent: candidate,
    })),
    { placeHolder }
  );
  return selection?.agent;
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
