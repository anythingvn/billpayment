import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { listServices, newId, putService } from '../storage/db';
import type { Service } from '../domain/types';
import { formatVnd } from '../domain/format';
import { useWrite } from '../ui/useOnline';

const emptyService = (): Service => ({ id: newId(), nameVi: '', nameEn: '', unitVi: '', unitEn: '', unitPrice: 0, archived: false });

function ServiceForm({ value, onSave, onCancel }: { value: Service; onSave(s: Service): void; onCancel(): void }) {
  const w = useWrite();
  const [s, setS] = useState(value);
  const [err, setErr] = useState('');
  const f = (k: 'nameVi' | 'nameEn' | 'unitVi' | 'unitEn', label: string) => (
    <label class="field">{label}<input value={s[k]} onInput={(e) => setS({ ...s, [k]: e.currentTarget.value })} /></label>
  );
  const save = () => {
    if (!s.nameVi.trim()) return setErr('Vietnamese name is required.');
    if (!Number.isInteger(s.unitPrice) || s.unitPrice < 0) return setErr('Price must be a whole number ≥ 0.');
    onSave({ ...s, nameVi: s.nameVi.trim(), nameEn: s.nameEn.trim() });
  };
  return (
    <div class="panel">
      {err && <p class="errors">{err}</p>}
      <div class="grid2">
        {f('nameVi', 'Name (Vietnamese) *')}{f('nameEn', 'Name (English)')}
        {f('unitVi', 'Unit (Vietnamese), e.g. tháng')}{f('unitEn', 'Unit (English), e.g. month')}
        <label class="field">Default unit price (VND)
          <input type="number" min={0} step={1000} value={s.unitPrice} onInput={(e) => setS({ ...s, unitPrice: Number(e.currentTarget.value) })} />
        </label>
      </div>
      <p><button class="btn" {...w()} onClick={save}>Save service</button> <button class="btn ghost" onClick={onCancel}>Cancel</button></p>
    </div>
  );
}

export function Services() {
  const { db } = useApp();
  const w = useWrite();
  const [items, setItems] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const load = async () => setItems((await listServices(db)).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')));
  useEffect(() => { load(); }, []);
  const save = async (s: Service) => { await putService(db, s); setEditing(null); load(); };
  const shown = items.filter((s) => showArchived || !s.archived);
  return (
    <div>
      <div class="page-head"><h2>Services</h2><button class="btn" {...w()} onClick={() => setEditing(emptyService())}>+ New service</button></div>
      {editing && <ServiceForm key={editing.id} value={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <label class="muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} /> Show archived</label>
      <table class="list">
        <thead><tr><th>Service</th><th>Unit</th><th class="r">Price</th><th /></tr></thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id}>
              <td>{s.nameVi}{s.nameEn && <span class="muted"> / {s.nameEn}</span>}{s.archived && <span class="muted"> (archived)</span>}</td>
              <td>{[s.unitVi, s.unitEn].filter(Boolean).join(' / ')}</td>
              <td class="r">{formatVnd(s.unitPrice)}</td>
              <td class="r">
                <button class="btn ghost" {...w()} onClick={() => setEditing(s)}>Edit</button>{' '}
                <button class="btn ghost" {...w()} onClick={() => save({ ...s, archived: !s.archived })}>{s.archived ? 'Unarchive' : 'Archive'}</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} class="muted">No services yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
