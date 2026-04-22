import * as vscode from 'vscode';
import { get5hStats, get7dStats } from '../../state/usage';
import type { Store } from '../../state/store';

type SummaryItem = {
  label: string;
  description?: string;
  iconId?: string;
  children?: SummaryItem[];
};

export class SummaryProvider implements vscode.TreeDataProvider<SummaryItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private store: Store) {
    store.onDidChange(() => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this._onDidChangeTreeData.fire(), 250);
    });
  }

  getTreeItem(element: SummaryItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    if (element.iconId) {
      item.iconPath = new vscode.ThemeIcon(element.iconId);
    }
    return item;
  }

  getChildren(element?: SummaryItem): SummaryItem[] {
    if (element) {
      return element.children ?? [];
    }
    return this.buildTree();
  }

  private buildTree(): SummaryItem[] {
    const stats5h = get5hStats(this.store);
    const stats7d = get7dStats(this.store);
    const { max5h, max7d } = this.store.settings;
    const claudeSession = this.store.getActiveSession('claude');
    const codexSession = this.store.getActiveSession('codex');

    const activeSessions: SummaryItem[] = [];
    if (claudeSession) {
      activeSessions.push({
        label: 'Claude',
        description: `${claudeSession.contextState} · score ${claudeSession.contextScore}`,
        iconId: contextIcon(claudeSession.contextState),
      });
    }
    if (codexSession) {
      activeSessions.push({
        label: 'Codex',
        description: `${codexSession.contextState} · score ${codexSession.contextScore}`,
        iconId: contextIcon(codexSession.contextState),
      });
    }
    if (activeSessions.length === 0) {
      activeSessions.push({ label: 'No active sessions', iconId: 'dash' });
    }

    return [
      {
        label: '5-Hour Window',
        iconId: 'clock',
        children: [
          { label: 'Total', description: `${stats5h.total} / ${max5h}` },
          { label: 'Claude', description: `${stats5h.byAgent.claude}` },
          { label: 'Codex', description: `${stats5h.byAgent.codex}` },
        ],
      },
      {
        label: '7-Day Window',
        iconId: 'calendar',
        children: [
          { label: 'Total', description: `${stats7d.total} / ${max7d}` },
          { label: 'Claude', description: `${stats7d.byAgent.claude}` },
          { label: 'Codex', description: `${stats7d.byAgent.codex}` },
        ],
      },
      {
        label: 'Active Sessions',
        iconId: 'debug-start',
        children: activeSessions,
      },
    ];
  }
}

function contextIcon(state: string): string {
  switch (state) {
    case 'bloated': return 'error';
    case 'heavy': return 'warning';
    case 'busy': return 'info';
    default: return 'pass';
  }
}
