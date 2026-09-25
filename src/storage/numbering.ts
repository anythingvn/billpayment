import type { AppDb } from './db';

export async function allocateBillNumber(db: AppDb, prefix: string, billDate: string): Promise<string> {
  const year = billDate.slice(0, 4);
  const key = `counter-${year}`;
  const tx = db.transaction('meta', 'readwrite');
  const next = (((await tx.store.get(key)) as number | undefined) ?? 0) + 1;
  await tx.store.put(next, key);
  await tx.done;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
