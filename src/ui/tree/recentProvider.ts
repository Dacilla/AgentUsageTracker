import * as vscode from 'vscode';
import { get5hStats, get7dStats } from '../../state/usage';
import type { Store } from '../../state/store';
import type { UsageEvent } from '../../types';

type RecentItem = {
  label: string;
  description?: string;
  iconId?: string;
  isGroup?: boolean;
  children?: RecentItem[];
};

export class RecentProvider implements vscode.TreeDataProvider<RecentItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private store: Store) {
    store.onDidChange(() => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this._onDidChangeTreeData.fire(), 250);
    });
  }

  getTreeItem(element: RecentItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.isGroup ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    if (element.iconId) {
      item.iconPath = new vscode.ThemeIcon(element.iconId);
    }
    return item;
  }

  getChildren(element?: RecentItem): RecentItem[] {
    if (element?.isGroup) {
      return element.children ?? [];
    }
    if (element) { return []; }
    return this.buildTree();
  }

  private buildTree(): RecentItem[] {
    const alerts = this.buildAlerts();
    const recent = this.buildRecentEvents();
    return [
      { label: 'Alerts', isGroup: true, iconId: 'bell', children: alerts.length > 0 ? alerts : [{ label: 'No alerts', iconId: 'check' }] },
      { label: 'Recent', isGroup: true, iconId: 'history', children: recent.length > 0 ? recent : [{ label: 'No events yet', iconId: 'dash' }] },
    ];
  }

  private buildAlerts(): RecentItem[] {
    const alerts: RecentItem[] = [];
    const stats5h = get5hStats(this.store);
    const stats7d = get7dStats(this.store);
    const { max5h, max7d } = this.store.settings;

    if (stats5h.total / max5h >= 0.80) {
      alerts.push({ label: `5h usage ${Math.round(stats5h.total / max5h * 100)}%`, iconId: 'warning' });
    }
    if (stats7d.total / max7d >= 0.80) {
      alerts.push({ label: `Weekly usage ${Math.round(stats7d.total / max7d * 100)}%`, iconId: 'warning' });
    }

    for (const session of this.store.getAllSessions()) {
      if (session.contextState === 'bloated') {
        alerts.push({ label: `${session.agent} session bloated`, description: `score ${session.contextScore}`, iconId: 'error' });
      } else if (session.contextState === 'heavy') {
        alerts.push({ label: `${session.agent} session heavy`, description: `score ${session.contextScore}`, iconId: 'warning' });
      }
    }

    return alerts;
  }

  private buildRecentEvents(): RecentItem[] {
    return this.store.getRecentEvents(20).map((e: UsageEvent) => ({
      label: e.agent === 'claude' ? 'Claude' : 'Codex',
      description: relativeTime(e.timestamp),
      iconId: 'comment',
    }));
  }
}

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) { return 'just now'; }
  if (diffMin < 60) { return `${diffMin} min ago`; }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) { return `${diffHr} hr ago`; }
  return `${Math.floor(diffHr / 24)} d ago`;
}
