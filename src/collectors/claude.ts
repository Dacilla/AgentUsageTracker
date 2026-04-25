import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { recordPrompt } from '../state/sessions';
import type { Store } from '../state/store';
import { createJsonlTreeWatcher } from './jsonlWatch';
import { parseClaudeJsonlLine } from './parsers';

// Known marketplace extension IDs for Claude Code.
// We try each in order and use the first one found.
const CLAUDE_EXTENSION_IDS = [
  'Anthropic.claude-code',
  'anthropic.claude-code',
];

export interface Collector {
  start(store: Store, outChannel: vscode.OutputChannel, context: vscode.ExtensionContext): void;
  stop(): void;
}

export function createClaudeCollector(): Collector {
  let fileWatcher: ReturnType<typeof createJsonlTreeWatcher> | undefined;
  let heuristicDisposable: vscode.Disposable | undefined;
  let lastHeuristicEvent = 0;

  function onPrompt(store: Store, workspace: string) {
    recordPrompt('claude', store, workspace);
  }

  function tryExtensionApi(store: Store, out: vscode.OutputChannel): boolean {
    for (const id of CLAUDE_EXTENSION_IDS) {
      const ext = vscode.extensions.getExtension(id);
      if (!ext) { continue; }
      out.appendLine(`Claude: found extension ${id}`);
      const exports = ext.exports as Record<string, unknown> | undefined;
      if (!exports) {
        out.appendLine(`Claude: extension ${id} has no exports, skipping API tier`);
        return false;
      }
      // Look for common event emitter patterns
      const eventSource =
        (typeof exports['onPrompt'] === 'function' && exports['onPrompt']) ||
        (typeof exports['onMessage'] === 'function' && exports['onMessage']) ||
        (typeof exports['events'] === 'object' && exports['events']);
      if (eventSource && typeof (eventSource as { on?: unknown }).on === 'function') {
        const emitter = eventSource as { on(event: string, cb: () => void): void };
        emitter.on('prompt', () => onPrompt(store, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''));
        emitter.on('message', () => onPrompt(store, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''));
        out.appendLine('Claude: using extension API (event emitter found)');
        return true;
      }
      out.appendLine(`Claude: extension ${id} exports no known event interface`);
      return false;
    }
    out.appendLine('Claude: extension not found in VS Code');
    return false;
  }

  function tryFileWatch(store: Store, out: vscode.OutputChannel): boolean {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    fileWatcher = createJsonlTreeWatcher({
      label: 'Claude',
      rootDir: claudeDir,
      out,
      parseLine: parseClaudeJsonlLine,
      onPrompt: workspace => onPrompt(store, workspace),
    });
    const started = fileWatcher.start();
    if (!started) {
      out.appendLine('Claude: ~/.claude/projects not found, skipping file watch tier');
    }
    return started;
  }

  function startHeuristic(store: Store, out: vscode.OutputChannel, context: vscode.ExtensionContext): void {
    out.appendLine('Claude: using heuristic fallback (document change detection)');
    const HEURISTIC_DEBOUNCE_MS = 10_000;
    heuristicDisposable = vscode.workspace.onDidChangeTextDocument(e => {
      const now = Date.now();
      if (now - lastHeuristicEvent < HEURISTIC_DEBOUNCE_MS) { return; }
      const linesAdded = e.contentChanges.reduce((sum, c) => {
        const newLines = c.text.split('\n').length - 1;
        return sum + (newLines > 10 ? newLines : 0);
      }, 0);
      if (linesAdded > 10) {
        lastHeuristicEvent = now;
        out.appendLine('Claude: prompt inferred via heuristic (large insertion)');
        onPrompt(store, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
      }
    });
    context.subscriptions.push(heuristicDisposable);
  }

  return {
    start(store, outChannel, context) {
      if (tryExtensionApi(store, outChannel)) { return; }
      if (tryFileWatch(store, outChannel)) { return; }
      startHeuristic(store, outChannel, context);
    },
    stop() {
      fileWatcher?.stop();
      heuristicDisposable?.dispose();
      fileWatcher = undefined;
    },
  };
}
