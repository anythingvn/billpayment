import type { Bill } from '../domain/types';

/** Makes a string safe as a Drive folder/file name: no path or reserved characters, max 100 chars, never empty. */
export function safeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
  return cleaned || '_';
}

/** Where a bill's PDF lives in Drive: main folder / year of bill date / customer, file named by bill number. */
export function billDrivePath(
  bill: Pick<Bill, 'number' | 'billDate' | 'customer'>,
  mainFolder: string,
): { folders: [string, string, string]; fileName: string } {
  return {
    folders: [safeName(mainFolder), bill.billDate.slice(0, 4), safeName(bill.customer.name)],
    fileName: `${safeName(bill.number)}.pdf`,
  };
}
