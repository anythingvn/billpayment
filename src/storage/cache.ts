import { openIdbStore, type IdbStore } from './idbStore';

/** The per-user read-only copy used for offline viewing (an IdbStore of its own). */
export const cacheName = (userId: string) => `payment-bills-cache-${userId}`;
export const openCache = (userId: string): Promise<IdbStore> => openIdbStore(cacheName(userId));

/** Deletes a user's offline copy (on sign-out). */
export function clearCache(userId: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(cacheName(userId));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
