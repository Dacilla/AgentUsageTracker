import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { recordPrompt } from '../state/sessions';
import type { Store } from '../state/store';

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
  let watcher: fs.FSWatcher | undefined;
  let subdirWatchers: fs.FSWatcher[] = [];
  let heuristicDisposable: vscode.Disposable | undefined;
  let lastHeuristicEvent = 0;
  let activeStore: Store | undefined;

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

  function readLastLine(filePath: string): string | null {
    try {
      const fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      const size = stat.size;
      if (size === 0) { fs.closeSync(fd); return null; }
      const readSize = Math.min(512, size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const newlineIdx = text.lastIndexOf('\n', text.length - 2);
      return newlineIdx === -1 ? text.trim() : text.slice(newlineIdx + 1).trim();
    } catch {
      return null;
    }
  }

  function isUserPromptLine(line: string): boolean {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Claude JSONL lines have a "type" field for conversation entries
      return obj['role'] === 'user' || obj['type'] === 'user';
    } catch {
      return false;
    }
  }

  function watchDir(dirPath: string, store: Store, out: vscode.OutputChannel): fs.FSWatcher | null {
    try {
      return fs.watch(dirPath, { recursive: process.platform !== 'linux' }, (event, filename) => {
        if (event !== 'change' || !filename || !filename.endsWith('.jsonl')) { return; }
        const filePath = path.join(dirPath, filename);
        const line = readLastLine(filePath);
        if (line && isUserPromptLine(line)) {
          out.appendLine(`Claude: prompt detected via file watch (${path.basename(filename)})`);
          onPrompt(store, dirPath);
        }
      });
    } catch {
      return null;
    }
  }

  function watchSubdirs(claudeDir: string, store: Store, out: vscode.OutputChannel): void {
    try {
      const entries = fs.readdirSync(claudeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sub = path.join(claudeDir, entry.name);
          const w = watchDir(sub, store, out);
          if (w) { subdirWatchers.push(w); }
        }
      }
      // Also watch the parent for new subdirectories appearing
      fs.watch(claudeDir, (event, filename) => {
        if (event === 'rename' && filename) {
          const sub = path.join(claudeDir, filename);
          try {
            if (fs.statSync(sub).isDirectory()) {
              const w = watchDir(sub, store, out);
              if (w) { subdirWatchers.push(w); }
            }
          } catch { /* directory may not exist yet */ }
        }
      });
    } catch { /* claudeDir may be inaccessible */ }
  }

  function tryFileWatch(store: Store, out: vscode.OutputChannel): boolean {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    try {
      fs.accessSync(claudeDir);
    } catch {
      out.appendLine(`Claude: ~/.claude/projects not found, skipping file watch tier`);
      return false;
    }

    out.appendLine(`Claude: watching ${claudeDir}`);

    if (process.platform === 'linux') {
      watchSubdirs(claudeDir, store, out);
    } else {
      watcher = watchDir(claudeDir, store, out) ?? undefined;
    }
    return true;
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
      activeStore = store;
      if (tryExtensionApi(store, outChannel)) { return; }
      if (tryFileWatch(store, outChannel)) { return; }
      startHeuristic(store, outChannel, context);
    },
    stop() {
      watcher?.close();
      for (const w of subdirWatchers) { w.close(); }
      subdirWatchers = [];
      heuristicDisposable?.dispose();
      watcher = undefined;
      activeStore = undefined;
    },
  };
}
