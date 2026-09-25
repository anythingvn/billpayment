import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { deleteOrArchiveCustomer, listCustomers, newId, putCustomer } from '../storage/db';
import type { Customer } from '../domain/types';

export const emptyCustomer = (): Customer => ({
  id: newId(), name: '', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false,
});

/** Shared by this screen and the editor's "add customer inline". */
export function CustomerForm({ value, onSave, onCancel }: { value: Customer; onSave(c: Customer): void; onCancel(): void }) {
  const [c, setC] = useState(value);
  const [err, setErr] = useState('');
  const f = (k: keyof Customer, label: string) => (
    <label class="field">{label}<input value={c[k] as string} onInput={(e) => setC({ ...c, [k]: e.currentTarget.value })} /></label>
  );
  return (
    <div class="panel">
      {err && <p class="errors">{err}</p>}
      <div class="grid2">
        {f('name', 'Name *')}{f('taxId', 'Tax ID (MST)')}{f('address', 'Address')}
        {f('contactPerson', 'Contact person')}{f('email', 'Email')}{f('phone', 'Phone')}
      </div>
      <p>
        <button class="btn" onClick={() => (c.name.trim() ? onSave({ ...c, name: c.name.trim() }) : setErr('Name is required.'))}>Save customer</button>{' '}
        <button class="btn ghost" onClick={onCancel}>Cancel</button>
      </p>
    </div>
  );
}

export function Customers() {
  const { db } = useApp();
  const [items, setItems] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const load = async () => setItems((await listCustomers(db)).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
  useEffect(() => { load(); }, []);

  const save = async (c: Customer) => { await putCustomer(db, c); setEditing(null); load(); };
  const remove = async (c: Customer) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    const r = await deleteOrArchiveCustomer(db, c.id);
    if (r === 'archived') alert(`${c.name} is used on bills, so it was archived instead of deleted.`);
    load();
  };

  const shown = items.filter((c) => showArchived || !c.archived);
  return (
    <div>
      <div class="page-head"><h2>Customers</h2><button class="btn" onClick={() => setEditing(emptyCustomer())}>+ New customer</button></div>
      {editing && <CustomerForm key={editing.id} value={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <label class="muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} /> Show archived</label>
      <table class="list">
        <thead><tr><th>Name</th><th>Tax ID</th><th>Contact</th><th /></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td>{c.name}{c.archived && <span class="muted"> (archived)</span>}</td>
              <td>{c.taxId}</td>
              <td>{[c.contactPerson, c.phone, c.email].filter(Boolean).join(' · ')}</td>
              <td class="r">
                <button class="btn ghost" onClick={() => setEditing(c)}>Edit</button>{' '}
                {c.archived
                  ? <button class="btn ghost" onClick={() => save({ ...c, archived: false })}>Unarchive</button>
                  : <button class="btn ghost" onClick={() => remove(c)}>Delete</button>}
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} class="muted">No customers yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
