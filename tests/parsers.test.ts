import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeJsonlLine, parseCodexJsonlLine } from '../src/collectors/parsers';

test('parseClaudeJsonlLine detects prompt lines and workspace', () => {
  const line = JSON.stringify({
    type: 'user',
    cwd: 'c:\\repo',
  });

  const parsed = parseClaudeJsonlLine(line);

  assert.deepEqual(parsed, { isPrompt: true, workspace: 'c:\\repo' });
});

test('parseCodexJsonlLine detects nested user_message payloads', () => {
  const line = JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'user_message',
      cwd: 'c:\\codex-repo',
      message: 'hello',
    },
  });

  const parsed = parseCodexJsonlLine(line);

  assert.deepEqual(parsed, { isPrompt: true, workspace: 'c:\\codex-repo' });
});

test('parseCodexJsonlLine ignores non-prompt records', () => {
  const line = JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
    },
  });

  const parsed = parseCodexJsonlLine(line);

  assert.deepEqual(parsed, { isPrompt: false, workspace: undefined });
});

test('parsers return null for invalid json', () => {
  assert.equal(parseClaudeJsonlLine('{'), null);
  assert.equal(parseCodexJsonlLine('{'), null);
});
