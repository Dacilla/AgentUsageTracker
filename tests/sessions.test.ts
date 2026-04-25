import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state/store';
import {
  computeContextScore,
  contextStateFromScore,
  recordPrompt,
  startFreshSession,
} from '../src/state/sessions';

function withMockedNow<T>(value: number, fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => value;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

test('computeContextScore uses the weighted heuristic', () => {
  const score = computeContextScore({
    id: 's1',
    agent: 'claude',
    startTime: 0,
    lastActivity: 0,
    promptCount: 0,
    turns: 4,
    filesTouched: 3,
    largeInputs: 2,
    retries: 1,
    contextScore: 0,
    contextState: 'healthy',
    workspace: '',
  });

  assert.equal(score, 31);
});

test('contextStateFromScore respects configured thresholds', () => {
  const thresholds = { busy: 50, heavy: 70, bloated: 85 };

  assert.equal(contextStateFromScore(10, thresholds), 'healthy');
  assert.equal(contextStateFromScore(50, thresholds), 'busy');
  assert.equal(contextStateFromScore(70, thresholds), 'heavy');
  assert.equal(contextStateFromScore(85, thresholds), 'bloated');
});

test('recordPrompt creates and updates a session with retries', () => {
  const store = new Store();

  withMockedNow(1_000, () => {
    recordPrompt('claude', store, 'c:\\repo');
  });

  let session = store.getActiveSession('claude');
  assert.ok(session);
  assert.equal(session.promptCount, 1);
  assert.equal(session.turns, 1);
  assert.equal(session.retries, 0);
  assert.equal(session.workspace, 'c:\\repo');

  withMockedNow(20_000, () => {
    recordPrompt('claude', store, 'c:\\repo');
  });

  session = store.getActiveSession('claude');
  assert.ok(session);
  assert.equal(session.promptCount, 2);
  assert.equal(session.turns, 2);
  assert.equal(session.retries, 1);
  assert.equal(store.getRecentEvents(5).length, 2);
});

test('startFreshSession replaces the current active session id', () => {
  const store = new Store();

  const first = withMockedNow(1_000, () => startFreshSession('codex', 'c:\\repo', store));
  const second = withMockedNow(2_000, () => startFreshSession('codex', 'c:\\repo', store));

  assert.notEqual(first.id, second.id);
  assert.equal(store.getActiveSession('codex')?.id, second.id);
});
