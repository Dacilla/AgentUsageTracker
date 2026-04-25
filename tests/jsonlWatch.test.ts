import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createJsonlTreeWatcher } from '../src/collectors/jsonlWatch';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for watcher event');
    }
    await sleep(25);
  }
}

test('jsonl watcher buffers partial lines and emits prompts after newline completion', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tracker-watch-'));
  const filePath = path.join(rootDir, 'session.jsonl');
  fs.writeFileSync(filePath, '');

  const prompts: Array<{ workspace: string; filePath: string }> = [];
  const logs: string[] = [];
  const watcher = createJsonlTreeWatcher({
    label: 'Test',
    rootDir,
    out: {
      appendLine(message: string) {
        logs.push(message);
      },
    } as any,
    parseLine(line) {
      try {
        const parsed = JSON.parse(line) as { prompt?: boolean; workspace?: string };
        return {
          isPrompt: parsed.prompt === true,
          workspace: parsed.workspace,
        };
      } catch {
        return null;
      }
    },
    onPrompt(workspace, detectedFilePath) {
      prompts.push({ workspace, filePath: detectedFilePath });
    },
  });

  try {
    assert.equal(watcher.start(), true);

    fs.appendFileSync(filePath, '{"prompt":true,"workspace":"c:\\\\repo"}');
    await sleep(150);
    assert.equal(prompts.length, 0);

    fs.appendFileSync(filePath, '\n');
    await waitFor(() => prompts.length === 1);

    assert.deepEqual(prompts, [{ workspace: 'c:\\repo', filePath }]);
    assert.equal(logs.some(line => line.includes('prompt detected via file watch')), true);
  } finally {
    watcher.stop();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
