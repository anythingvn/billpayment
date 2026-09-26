import type { Settings } from '../domain/types';
import type { AppDb } from './db';

/** Next contract number {n}/{YYYY}/{type}[-{suffix}], counted per year of the signing date (separate from bills). */
export async function allocateContractNumber(db: AppDb, s: Settings, signedDate: string): Promise<string> {
  const year = signedDate.slice(0, 4);
  const key = `contract-counter-${year}`;
  const next = await db.nextCounter(key);
  const suffix = s.contractSuffix.trim();
  return `${next}/${year}/${s.contractType.trim()}${suffix ? `-${suffix}` : ''}`;
}

/** The number allocateContractNumber would give next, without using it up (for the editor's suggestion). */
export async function peekContractNumber(db: AppDb, s: Settings, signedDate: string): Promise<string> {
  const year = signedDate.slice(0, 4);
  const next = ((await db.getMeta<number>(`contract-counter-${year}`)) ?? 0) + 1;
  const suffix = s.contractSuffix.trim();
  return `${next}/${year}/${s.contractType.trim()}${suffix ? `-${suffix}` : ''}`;
}
