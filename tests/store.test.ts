import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state/store';

test('settings updates notify listeners', () => {
  const store = new Store();
  let notifications = 0;

  store.onDidChange(() => {
    notifications++;
  });

  store.settings = {
    ...store.settings,
    max5h: 99,
  };

  assert.equal(store.settings.max5h, 99);
  assert.equal(notifications, 1);
});

test('setActiveSession can notify listeners', () => {
  const store = new Store();
  let notifications = 0;

  store.onDidChange(() => {
    notifications++;
  });

  store.setActiveSession('claude', 'session-1');

  assert.equal(notifications, 1);
  assert.equal(store.getActiveSession('claude'), undefined);
});

test('serialize and hydrate preserve snoozed session ids', () => {
  const store = new Store();

  store.toggleSessionSnooze('session-a');
  const serialized = store.serialize();

  const hydrated = new Store();
  hydrated.hydrate(serialized);

  assert.equal(hydrated.isSessionSnoozed('session-a'), true);
  assert.equal(hydrated.isSessionSnoozed('session-b'), false);
});
