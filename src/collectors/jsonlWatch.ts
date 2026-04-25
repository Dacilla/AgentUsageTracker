import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ParsedCollectorLine } from './parsers';

interface JsonlWatchOptions {
  label: string;
  rootDir: string;
  out: vscode.OutputChannel;
  parseLine: (line: string) => ParsedCollectorLine | null;
  onPrompt: (workspace: string, filePath: string) => void;
}

export interface JsonlTreeWatcher {
  start(): boolean;
  stop(): void;
}

export function createJsonlTreeWatcher(options: JsonlWatchOptions): JsonlTreeWatcher {
  const watchers: fs.FSWatcher[] = [];
  const watchedDirs = new Set<string>();
  const fileOffsets = new Map<string, number>();
  const fileRemainders = new Map<string, string>();
  const fileWorkspaces = new Map<string, string>();

  function cleanupFile(filePath: string): void {
    fileOffsets.delete(filePath);
    fileRemainders.delete(filePath);
    fileWorkspaces.delete(filePath);
  }

  function seedExistingFiles(dirPath: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        seedExistingFiles(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      try {
        fileOffsets.set(fullPath, fs.statSync(fullPath).size);
      } catch {
        cleanupFile(fullPath);
      }
    }
  }

  function readChunk(filePath: string, start: number, end: number): string {
    if (end <= start) {
      return '';
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(end - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  function processFile(filePath: string, readFromStart = false): void {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      cleanupFile(filePath);
      return;
    }

    let previousOffset = fileOffsets.get(filePath);
    if (previousOffset === undefined) {
      previousOffset = readFromStart ? 0 : size;
    }

    if (size < previousOffset) {
      previousOffset = 0;
      fileRemainders.delete(filePath);
    }

    if (size === previousOffset) {
      fileOffsets.set(filePath, size);
      return;
    }

    const chunk = readChunk(filePath, previousOffset, size);
    fileOffsets.set(filePath, size);

    const prefix = fileRemainders.get(filePath) ?? '';
    const text = prefix + chunk;
    fileRemainders.delete(filePath);

    const lines = text.split(/\r?\n/);
    if (!text.endsWith('\n')) {
      fileRemainders.set(filePath, lines.pop() ?? '');
    } else if (lines.at(-1) === '') {
      lines.pop();
    }

    let promptCount = 0;
    let workspace = fileWorkspaces.get(filePath) ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const parsed = options.parseLine(line);
      if (!parsed) {
        continue;
      }

      if (parsed.workspace) {
        workspace = parsed.workspace;
        fileWorkspaces.set(filePath, workspace);
      }

      if (!parsed.isPrompt) {
        continue;
      }

      promptCount++;
      options.onPrompt(workspace, filePath);
    }

    if (promptCount > 0) {
      const suffix = promptCount > 1 ? ` x${promptCount}` : '';
      options.out.appendLine(
        `${options.label}: prompt detected via file watch (${path.basename(filePath)}${suffix})`
      );
    }
  }

  function registerLinuxDirectory(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    if (watchedDirs.has(resolved)) {
      return;
    }

    watchedDirs.add(resolved);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        registerLinuxDirectory(path.join(resolved, entry.name));
      }
    }

    try {
      const watcher = fs.watch(resolved, (event, filename) => {
        if (!filename) {
          return;
        }

        const targetPath = path.join(resolved, filename.toString());
        if (event === 'rename') {
          try {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
              registerLinuxDirectory(targetPath);
              seedExistingFiles(targetPath);
            } else if (stat.isFile() && targetPath.endsWith('.jsonl')) {
              processFile(targetPath, true);
            }
          } catch {
            cleanupFile(targetPath);
          }
          return;
        }

        if (event === 'change' && targetPath.endsWith('.jsonl')) {
          processFile(targetPath);
        }
      });
      watchers.push(watcher);
    } catch {
      watchedDirs.delete(resolved);
    }
  }

  return {
    start(): boolean {
      try {
        fs.accessSync(options.rootDir);
      } catch {
        return false;
      }

      seedExistingFiles(options.rootDir);
      options.out.appendLine(`${options.label}: watching ${options.rootDir}`);

      if (process.platform === 'linux') {
        registerLinuxDirectory(options.rootDir);
        return true;
      }

      try {
        const watcher = fs.watch(
          options.rootDir,
          { recursive: true },
          (event, filename) => {
            if (!filename) {
              return;
            }

            const targetPath = path.join(options.rootDir, filename.toString());
            if (event === 'rename') {
              try {
                const stat = fs.statSync(targetPath);
                if (stat.isDirectory()) {
                  seedExistingFiles(targetPath);
                } else if (stat.isFile() && targetPath.endsWith('.jsonl')) {
                  processFile(targetPath, true);
                }
              } catch {
                cleanupFile(targetPath);
              }
              return;
            }

            if (event === 'change' && targetPath.endsWith('.jsonl')) {
              processFile(targetPath);
            }
          }
        );
        watchers.push(watcher);
        return true;
      } catch {
        return false;
      }
    },

    stop(): void {
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
      watchedDirs.clear();
      fileOffsets.clear();
      fileRemainders.clear();
      fileWorkspaces.clear();
    },
  };
}
