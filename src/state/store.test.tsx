// @vitest-environment jsdom
/**
 * Regression for the onboarding redirect loop.
 *
 * Onboarding.finish() runs several writes in one async handler using the action
 * callbacks captured from the pre-completion render. Previously mutate() rebuilt
 * the whole snapshot from a stale `data` closure and reverted the just-applied
 * preferences.onboarded back to false, bouncing the app to the wizard. These
 * tests reproduce that exact sequence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Snapshot } from '../repo/local';

const { snapshotRef } = vi.hoisted(() => ({
  snapshotRef: { current: null as unknown as Snapshot },
}));

vi.mock('../repo/remote', () => ({
  remoteRepository: {
    mode: 'server',
    init: vi.fn(async () => {}),
    loadAll: vi.fn(async () => snapshotRef.current),
    putCollection: vi.fn(async (_n: string, r: { id: string }) => r),
    bulkPut: vi.fn(async () => {}),
    replaceCollection: vi.fn(async () => {}),
    putPlan: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    removeMany: vi.fn(async () => {}),
    setKV: vi.fn(async () => {}),
    clearData: vi.fn(async () => {}),
    importLocal: vi.fn(async () => ({ imported: 0, skippedDemo: 0 })),
  },
}));

import { AppProvider, useApp } from './store';

function makeSnapshot(onboarded: boolean): Snapshot {
  return {
    meta: { storageMode: 'server', demoActive: false, createdAt: '', schemaVersion: 1 },
    preferences: {
      displayName: 'T', currency: 'INR', timeZone: 'Asia/Kolkata', budgetPeriod: 'calendar',
      theme: 'dark', reducedMotion: false, remindersEnabled: false, onboarded,
    },
    roastSettings: { enabled: false },
    reminders: {},
    categories: [], salaryReceipts: [], allocations: [], transactions: [], budgets: [],
    plans: [], roastEvents: [], healthLogs: [], symptoms: [], medicationLogs: [],
    measurementTypes: [], measurementEntries: [],
  } as unknown as Snapshot;
}

const wrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;

beforeEach(() => {
  snapshotRef.current = makeSnapshot(false);
});

describe('onboarding completion survives the write batch', () => {
  it('keeps onboarded=true after a collection write follows updatePreferences', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Capture the action callbacks from the pre-completion render, exactly like
    // Onboarding.finish() does — this is what exposed the stale-closure clobber.
    const api = result.current;
    await act(async () => { await api.updatePreferences({ onboarded: true }); });
    await act(async () => {
      await api.upsertBudget({ id: 'bud-1', month: '2026-10', categoryId: null, limitMinor: 5000 });
    });

    expect(result.current.data?.preferences.onboarded).toBe(true);
  });

  it('keeps onboarded=true across the full multi-write onboarding sequence', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const api = result.current;
    await act(async () => { await api.updatePreferences({ onboarded: true }); });
    await act(async () => { await api.setPlan({ month: '2026-10', expectedSalaryMinor: 400000 }); });
    await act(async () => {
      await api.upsertAllocation({ id: 'a1', month: '2026-10', categoryId: 'cat-food', label: 'x', plannedMinor: 1000 });
    });
    await act(async () => {
      await api.upsertSalaryReceipt({ id: 's1', month: '2026-10', amountMinor: 400000, date: '2026-10-01' });
    });

    expect(result.current.data?.preferences.onboarded).toBe(true);
    // The batched writes must all be present in the live snapshot too (not just the last).
    expect(result.current.data?.budgets ?? result.current.data?.allocations).toBeTruthy();
    expect(result.current.data?.allocations.some((a) => a.id === 'a1')).toBe(true);
    expect(result.current.data?.salaryReceipts.some((s) => s.id === 's1')).toBe(true);
    expect(result.current.data?.plans.some((p) => p.month === '2026-10')).toBe(true);
  });

  it('reflects server-persisted completion after a reload (browser refresh)', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.updatePreferences({ onboarded: true }); });

    snapshotRef.current = makeSnapshot(true); // the PUT persisted it; bootstrap now returns true
    await act(async () => { await result.current.reload(); });

    expect(result.current.data?.preferences.onboarded).toBe(true);
  });
});
