import type { Tracked } from '../domain/types';

const pad = (n: number) => String(n).padStart(2, '0');
const short = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "Created by An · changed by Lan 26/09 10:05" for records saved on a server. */
export function Authorship({ record }: { record: Tracked & { updatedAt?: string } }) {
  if (!record.createdBy) return null;
  const changed = record.updatedBy && record.updatedAt ? ` · changed by ${record.updatedBy} ${short(record.updatedAt)}` : '';
  return <p class="muted no-print" style="margin:4px 0 10px">{`Created by ${record.createdBy}${changed}`}</p>;
}
