import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { recordPrompt } from '../state/sessions';
import type { Store } from '../state/store';
import type { Collector } from './claude';

// Known marketplace extension IDs for OpenAI Codex.
const CODEX_EXTENSION_IDS = [
  'openai.codex',
  'OpenAI.codex',
  'openai.openai-codex',
];

// Candidate filesystem paths where the Codex engine may write session data.
// Probed in order; first one that exists wins.
function candidateCodexDirs(): string[] {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.codex'),
    path.join(home, '.openai', 'codex'),
    path.join(home, '.openai'),
  ];
  if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'codex'));
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) { candidates.push(path.join(appData, 'codex')); }
  }
  return candidates;
}

export function createCodexCollector(): Collector {
  let watcher: fs.FSWatcher | undefined;
  let subdirWatchers: fs.FSWatcher[] = [];
  let heuristicDisposable: vscode.Disposable | undefined;
  let lastHeuristicEvent = 0;

  function onPrompt(store: Store, workspace: string) {
    recordPrompt('codex', store, workspace);
  }

  function tryExtensionApi(store: Store, out: vscode.OutputChannel): boolean {
    for (const id of CODEX_EXTENSION_IDS) {
      const ext = vscode.extensions.getExtension(id);
      if (!ext) { continue; }
      out.appendLine(`Codex: found extension ${id}`);
      const exports = ext.exports as Record<string, unknown> | undefined;
      if (!exports) {
        out.appendLine(`Codex: extension ${id} has no exports, skipping API tier`);
        return false;
      }
      const eventSource =
        (typeof exports['onPrompt'] === 'function' && exports['onPrompt']) ||
        (typeof exports['onMessage'] === 'function' && exports['onMessage']) ||
        (typeof exports['events'] === 'object' && exports['events']);
      if (eventSource && typeof (eventSource as { on?: unknown }).on === 'function') {
        const emitter = eventSource as { on(event: string, cb: () => void): void };
        emitter.on('prompt', () => onPrompt(store, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''));
        emitter.on('message', () => onPrompt(store, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''));
        out.appendLine('Codex: using extension API (event emitter found)');
        return true;
      }
      out.appendLine(`Codex: extension ${id} exports no known event interface`);
      return false;
    }
    out.appendLine('Codex: extension not found in VS Code');
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
          out.appendLine(`Codex: prompt detected via file watch (${path.basename(filename)})`);
          onPrompt(store, dirPath);
        }
      });
    } catch {
      return null;
    }
  }

  function watchSubdirs(codexDir: string, store: Store, out: vscode.OutputChannel): void {
    try {
      const entries = fs.readdirSync(codexDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sub = path.join(codexDir, entry.name);
          const w = watchDir(sub, store, out);
          if (w) { subdirWatchers.push(w); }
        }
      }
      fs.watch(codexDir, (event, filename) => {
        if (event === 'rename' && filename) {
          const sub = path.join(codexDir, filename);
          try {
            if (fs.statSync(sub).isDirectory()) {
              const w = watchDir(sub, store, out);
              if (w) { subdirWatchers.push(w); }
            }
          } catch { /* may not exist yet */ }
        }
      });
    } catch { /* codexDir may be inaccessible */ }
  }

  function tryFileWatch(store: Store, out: vscode.OutputChannel): boolean {
    for (const dir of candidateCodexDirs()) {
      try {
        fs.accessSync(dir);
        out.appendLine(`Codex: watching ${dir}`);
        if (process.platform === 'linux') {
          watchSubdirs(dir, store, out);
        } else {
          watcher = watchDir(dir, store, out) ?? undefined;
        }
        return true;
      } catch { /* try next candidate */ }
    }
    out.appendLine('Codex: no session directory found, skipping file watch tier');
    return false;
  }

  function startHeuristic(store: Store, out: vscode.OutputChannel, context: vscode.ExtensionContext): void {
    out.appendLine('Codex: using heuristic fallback (document change detection)');
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
        out.appendLine('Codex: prompt inferred via heuristic (large insertion)');
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
      watcher?.close();
      for (const w of subdirWatchers) { w.close(); }
      subdirWatchers = [];
      heuristicDisposable?.dispose();
      watcher = undefined;
    },
  };
}
