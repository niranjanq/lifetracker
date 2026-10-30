import { http } from '../api/http';
import type { CollectionName, Snapshot } from './local';
import type { PlanRecord } from '../domain/finance';

/**
 * Server-backed repository exposing the SAME method surface the store already
 * calls on `localRepository`, so swapping persistence to PostgreSQL required no
 * changes to the store's business logic.
 *
 * Records are addressed by their stable domain id (e.g. 'tx-abc', 'cat-food');
 * the backend scopes every operation to the authenticated user, so this layer
 * never needs to reason about other users' data (points 2, 4, 7).
 */
export const remoteRepository = {
  mode: 'server' as const,

  /** Seeding happens server-side in /bootstrap; nothing to initialise here. */
  async init(): Promise<void> {},

  async loadAll(): Promise<Snapshot> {
    return http.get<Snapshot>('/bootstrap');
  },

  async putCollection<T extends { id: string }>(name: CollectionName, record: T): Promise<T> {
    await http.post(`/${name}`, record);
    return record;
  },

  async bulkPut<T extends { id: string }>(name: CollectionName, records: T[]): Promise<void> {
    // Sequential upserts keep per-record validation independent; the store only
    // bulk-puts small sets (roast events, demo records).
    for (const r of records) await http.post(`/${name}`, r);
  },

  /** Transactional full-set replacement: the collection ends up exactly `records`. */
  async replaceCollection<T extends { id: string }>(name: CollectionName, records: T[]): Promise<void> {
    await http.put(`/${name}/replace`, records);
  },

  /** Plans are keyed by month (no `id`); the backend maps external_id = month. */
  async putPlan(plan: PlanRecord): Promise<void> {
    await http.post('/plans', plan);
  },

  async remove(name: CollectionName, id: string): Promise<void> {
    await http.del(`/${name}/${encodeURIComponent(id)}`);
  },

  async removeMany(name: CollectionName, ids: string[]): Promise<void> {
    for (const id of ids) await http.del(`/${name}/${encodeURIComponent(id)}`);
  },

  async setKV(key: string, value: unknown): Promise<void> {
    if (key === 'preferences' || key === 'roastSettings' || key === 'reminders') {
      await http.put(`/settings/${key}`, value);
    }
    // 'meta' is derived server-side (storageMode / demoActive) — intentionally a no-op.
  },

  async clearData(opts: { keepPreferences: boolean }): Promise<void> {
    await http.post('/reset', { keepPreferences: opts.keepPreferences });
  },

  /** Explicit, consent-gated import of a browser snapshot (point 15). */
  async importLocal(data: unknown, includeDemo: boolean): Promise<{ imported: number; skippedDemo: number }> {
    return http.post('/import', { data, includeDemo });
  },
};

export type RemoteRepository = typeof remoteRepository;
