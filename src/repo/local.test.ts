import { describe, it, expect, beforeAll } from 'vitest';
import { localRepository, DEFAULT_PREFERENCES } from './local';
import type { Snapshot } from './local';
import type { Transaction } from '../domain/types';
import { CAT, DEFAULT_CATEGORIES } from '../domain/categories';

// A module-scoped handle: the in-memory IndexedDB persists across cases in
// this file, so we assert a clear create -> read -> delete lifecycle in order.
let snap: Snapshot;

function makeTx(id: string, demo = false): Transaction {
  return {
    id,
    month: '2026-10',
    date: '2026-10-05',
    kind: 'expense',
    categoryId: CAT.food,
    amountMinor: 12345,
    tags: [],
    demo,
    createdAt: '2026-10-05T00:00:00.000Z',
  };
}

beforeAll(async () => {
  await localRepository.init();
  snap = await localRepository.loadAll();
});

describe('localRepository.init', () => {
  it('seeds default categories and measurement types', () => {
    expect(snap.categories.map((c) => c.id).sort()).toEqual(DEFAULT_CATEGORIES.map((c) => c.id).sort());
    expect(snap.measurementTypes.length).toBeGreaterThan(0);
  });

  it('seeds default preferences and marks storage as local', () => {
    expect(snap.preferences).toMatchObject({ currency: DEFAULT_PREFERENCES.currency, onboarded: false });
    expect(snap.meta.storageMode).toBe('local');
    expect(snap.meta.demoActive).toBe(false);
  });

  it('is idempotent — re-init does not duplicate categories', async () => {
    await localRepository.init();
    const again = await localRepository.loadAll();
    expect(again.categories.length).toBe(DEFAULT_CATEGORIES.length);
  });
});

describe('write-through persistence', () => {
  it('persists a new transaction and reads it back', async () => {
    await localRepository.putCollection('transactions', makeTx('txn-1'));
    const after = await localRepository.loadAll();
    const found = after.transactions.find((t) => t.id === 'txn-1');
    expect(found?.amountMinor).toBe(12345);
  });

  it('preserves the demo flag on bulk-inserted records', async () => {
    await localRepository.bulkPut('transactions', [makeTx('txn-demo', true)]);
    const after = await localRepository.loadAll();
    expect(after.transactions.find((t) => t.id === 'txn-demo')?.demo).toBe(true);
  });

  it('removes a record by id', async () => {
    await localRepository.remove('transactions', 'txn-1');
    const after = await localRepository.loadAll();
    expect(after.transactions.find((t) => t.id === 'txn-1')).toBeUndefined();
  });

  it('removes many records at once', async () => {
    await localRepository.bulkPut('transactions', [makeTx('txn-b1'), makeTx('txn-b2')]);
    await localRepository.removeMany('transactions', ['txn-b1', 'txn-b2']);
    const after = await localRepository.loadAll();
    expect(after.transactions.filter((t) => t.id.startsWith('txn-b')).length).toBe(0);
  });

  it('persists preference updates through the KV store', async () => {
    await localRepository.setKV('preferences', { ...DEFAULT_PREFERENCES, currency: 'USD', onboarded: true });
    const after = await localRepository.loadAll();
    expect(after.preferences.currency).toBe('USD');
    expect(after.preferences.onboarded).toBe(true);
  });
});

describe('clearData', () => {
  it('wipes records and resets defaults when preferences are not kept', async () => {
    await localRepository.putCollection('transactions', makeTx('txn-wipe'));
    await localRepository.clearData({ keepPreferences: false });
    const after = await localRepository.loadAll();
    expect(after.transactions.length).toBe(0);
    expect(after.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(after.categories.length).toBe(DEFAULT_CATEGORIES.length);
    expect(after.meta.demoActive).toBe(false);
  });
});
