import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { recordPrompt } from '../state/sessions';
import type { Store } from '../state/store';
import type { Collector } from './claude';
import { createJsonlTreeWatcher } from './jsonlWatch';
import { parseCodexJsonlLine } from './parsers';

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
  let fileWatcher: ReturnType<typeof createJsonlTreeWatcher> | undefined;
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

  function tryFileWatch(store: Store, out: vscode.OutputChannel): boolean {
    for (const dir of candidateCodexDirs()) {
      fileWatcher = createJsonlTreeWatcher({
        label: 'Codex',
        rootDir: dir,
        out,
        parseLine: parseCodexJsonlLine,
        onPrompt: workspace => onPrompt(store, workspace),
      });
      if (fileWatcher.start()) {
        return true;
      }
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
      fileWatcher?.stop();
      heuristicDisposable?.dispose();
      fileWatcher = undefined;
    },
  };
}
