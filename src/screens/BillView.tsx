import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { getBill, putBill } from '../storage/db';
import type { Bill, BillStatus } from '../domain/types';
import { applyStatus, canTransition } from '../domain/status';
import { draftFromBill } from '../domain/draft';
import { formatDateVn, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { StatusBadge } from './Home';

const ACTIONS: { to: BillStatus; label: string; confirm?: string }[] = [
  { to: 'sent', label: 'Mark as sent' },
  { to: 'paid', label: 'Mark as paid' },
  { to: 'cancelled', label: 'Cancel bill', confirm: 'Cancel this bill? Its number will not be reused.' },
];

export function BillView({ id }: { id: string }) {
  const { db, settings } = useApp();
  const [bill, setBill] = useState<Bill | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => { getBill(db, id).then((b) => setBill(b ?? null)); }, [id]);
  const draft = bill ? draftFromBill(bill) : null;
  const qr = useQrDataUrl(draft ? billQrPayload(draft, settings) : null);

  if (bill === undefined) return <p class="muted">Loading…</p>;
  if (bill === null || !draft) return <p>Bill not found. <button class="btn ghost" onClick={() => navigate({ name: 'home' })}>Back to bills</button></p>;

  const change = async (to: BillStatus, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    // Undoing "paid" is labelled clearly so it is not clicked by accident.
    try {
      const next = applyStatus(bill, to, todayIso(), new Date().toISOString());
      await putBill(db, next);
      setBill(next);
    } catch (e) {
      setError(String(e));
    }
  };

  // Drafts are sent from the editor, where the export checks run; here they can only be continued or cancelled.
  const isDraft = bill.status === 'draft';
  const actions = [
    ...ACTIONS.filter((a) => canTransition(bill.status, a.to) && !(bill.status === 'paid' && a.to === 'sent') && !(isDraft && a.to === 'sent')),
    ...(bill.status === 'paid' ? [{ to: 'sent' as BillStatus, label: 'Undo paid', confirm: 'Mark this bill as not paid?' }] : []),
  ];

  return (
    <div>
      <div class="page-head no-print">
        <h2>{bill.number} <StatusBadge bill={bill} today={todayIso()} /></h2>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          {isDraft && <button class="btn" onClick={() => navigate({ name: 'editBill', id: bill.id })}>Continue in editor</button>}
          {actions.map((a) => <button key={a.label} class={a.to === 'cancelled' ? 'btn danger' : 'btn ghost'} onClick={() => change(a.to, a.confirm)}>{a.label}</button>)}
          <button class="btn ghost" onClick={() => navigate({ name: 'duplicateBill', id: bill.id })}>Duplicate</button>
          {bill.status !== 'cancelled' && !isDraft && <button class="btn" disabled={!qr} onClick={() => printBill(pdfFileName(bill.number, bill.customer.name))}>Export PDF</button>}
        </span>
      </div>
      {error && <p class="errors no-print">{error}</p>}
      {bill.paidDate && <p class="muted no-print">Paid on {formatDateVn(bill.paidDate)}</p>}
      {bill.status !== 'draft' && <p class="muted no-print">This bill is locked. Duplicate it to make changes.</p>}
      <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={qr} /></div>
    </div>
  );
}
