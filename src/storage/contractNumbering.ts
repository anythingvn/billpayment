import type { Settings } from '../domain/types';
import type { AppDb } from './db';

/** Next contract number {n}/{YYYY}/{type}[-{suffix}], counted per year of the signing date (separate from bills). */
export async function allocateContractNumber(db: AppDb, s: Settings, signedDate: string): Promise<string> {
  const year = signedDate.slice(0, 4);
  const key = `contract-counter-${year}`;
  const tx = db.transaction('meta', 'readwrite');
  const next = (((await tx.store.get(key)) as number | undefined) ?? 0) + 1;
  await tx.store.put(next, key);
  await tx.done;
  const suffix = s.contractSuffix.trim();
  return `${next}/${year}/${s.contractType.trim()}${suffix ? `-${suffix}` : ''}`;
}
