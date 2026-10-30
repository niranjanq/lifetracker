import { localRepository } from '../repo/local';
import { remoteRepository } from '../repo/remote';

export interface ImportPreview {
  /** Record counts currently sitting in this browser's IndexedDB. */
  counts: Record<string, number>;
  demoCount: number;
  total: number;
}

/** Read the browser snapshot and summarize it for a consent dialog — no write. */
export async function previewBrowserData(): Promise<ImportPreview> {
  const snap = await localRepository.loadAll();
  const counts: Record<string, number> = {
    transactions: snap.transactions.length,
    salaryReceipts: snap.salaryReceipts.length,
    allocations: snap.allocations.length,
    budgets: snap.budgets.length,
    plans: snap.plans.length,
    healthLogs: snap.healthLogs.length,
    symptoms: snap.symptoms.length,
    medicationLogs: snap.medicationLogs.length,
    measurementEntries: snap.measurementEntries.length,
    categories: snap.categories.length,
  };
  const demoCount =
    snap.transactions.filter((t) => t.demo).length +
    snap.healthLogs.filter((h) => h.demo).length +
    snap.medicationLogs.filter((m) => m.demo).length +
    snap.measurementEntries.filter((m) => m.demo).length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, demoCount, total };
}

/**
 * Import the browser snapshot into the authenticated account. Records are tagged
 * `imported:true` server-side and are only ever written under the current user.
 * Demo records are included ONLY when the caller explicitly opts in (consent).
 */
export async function importBrowserData(
  includeDemo: boolean,
): Promise<{ imported: number; skippedDemo: number }> {
  const snap = await localRepository.loadAll();
  // Drop meta (storage provenance) — the server owns meta for account data.
  const { meta: _meta, ...rest } = snap;
  return remoteRepository.importLocal(rest, includeDemo);
}
