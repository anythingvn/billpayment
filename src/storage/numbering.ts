import type { AppDb } from './db';

export async function allocateBillNumber(db: AppDb, prefix: string, billDate: string): Promise<string> {
  const year = billDate.slice(0, 4);
  const key = `counter-${year}`;
  const next = await db.nextCounter(key);
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
