export function formatVnd(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatDateVn(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

export function pdfFileName(number: string, customerName: string, draft = false): string {
  const safe = customerName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${number}_${safe}${draft ? '_DRAFT' : ''}`;
}
