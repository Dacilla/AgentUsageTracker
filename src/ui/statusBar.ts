import * as vscode from 'vscode';
import { get5hStats, get7dStats } from '../state/usage';
import type { Store } from '../state/store';

export function createStatusBar(store: Store, context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'agentTracker.openDashboard';

  function update() {
    const stats5h = get5hStats(store);
    const stats7d = get7dStats(store);
    const { max5h, max7d } = store.settings;

    const claudeSession = store.getActiveSession('claude');
    const codexSession = store.getActiveSession('codex');

    item.text = `$(robot) C:${stats5h.byAgent.claude} X:${stats5h.byAgent.codex} · 5h:${stats5h.total}/${max5h}`;

    const tooltip = new vscode.MarkdownString(
      `**Agent Usage Tracker**\n\n` +
      `5h: Claude ${stats5h.byAgent.claude}/${max5h} · Codex ${stats5h.byAgent.codex}/${max5h}\n\n` +
      `7d: Claude ${stats7d.byAgent.claude}/${max7d} · Codex ${stats7d.byAgent.codex}/${max7d}\n\n` +
      (claudeSession ? `Claude session: **${claudeSession.contextState}** (score ${claudeSession.contextScore})\n\n` : '') +
      (codexSession ? `Codex session: **${codexSession.contextState}** (score ${codexSession.contextScore})` : '') +
      `\n\nClick to open dashboard`
    );
    tooltip.isTrusted = true;
    item.tooltip = tooltip;

    const pct5h = stats5h.total / max5h;
    const pct7d = stats7d.total / max7d;
    const maxPct = Math.max(pct5h, pct7d);
    const bloated = claudeSession?.contextState === 'bloated' || codexSession?.contextState === 'bloated';
    const heavy = claudeSession?.contextState === 'heavy' || codexSession?.contextState === 'heavy';

    if (maxPct >= 0.95 || bloated) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (maxPct >= 0.80 || heavy) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      item.backgroundColor = undefined;
    }

    item.show();
  }

  update();
  const unsubscribe = store.onDidChange(update);
  context.subscriptions.push({ dispose: unsubscribe });

  return item;
}
