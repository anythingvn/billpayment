import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { newId, putSettings } from '../storage/db';
import { BANKS } from '../domain/banks';
import { isValidAccount } from '../domain/vietqr';
import { connectDrive, disconnectDrive, driveConfigured, driveConnection, prepareDrive } from '../drive/service';
import { VAT_RATES, type SavedBankAccount, type Settings, type VatRate } from '../domain/types';

const MAX_LOGO_BYTES = 300 * 1024;

export function SettingsScreen() {
  const { db, settings, reloadSettings } = useApp();
  const [s, setS] = useState<Settings>(settings);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS({ ...s, [k]: v }); setMsg(''); };
  const text = (k: keyof Settings, label: string) => (
    <label class="field">{label}
      <input value={s[k] as string} onInput={(e) => set(k, e.currentTarget.value as never)} />
    </label>
  );

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) { setMsg('Logo must be smaller than 300 KB.'); return; }
    const r = new FileReader();
    r.onload = () => set('logoDataUrl', r.result as string);
    r.readAsDataURL(file);
  };

  const [drive, setDrive] = useState<{ email: string | null } | null>(null);
  const [driveMsg, setDriveMsg] = useState('');
  useEffect(() => {
    driveConnection(db).then(setDrive);
    prepareDrive(db, settings);
  }, [settings.googleClientId]);
  const connect = async () => {
    setDriveMsg('');
    try {
      setDrive(await connectDrive(db, settings));
    } catch (e) {
      setDriveMsg(e instanceof Error && /origin/i.test(e.message) ? e.message
        : `Could not connect to Google Drive. If Google showed an error page, check that ${location.origin} is listed under Authorized JavaScript origins of your Client ID (see How to set up), then try again.`);
    }
  };
  const disconnect = async () => {
    await disconnectDrive(db, settings).catch(() => undefined);
    setDrive(null);
  };

  const save = async () => {
    if (s.driveFolderName.includes('/')) { setMsg('Main folder name cannot contain /'); return; }
    if (s.googleClientId.trim() && !s.driveFolderName.trim()) { setMsg('Enter a main folder name for Google Drive'); return; }
    if (!/^[A-Za-z0-9]{1,6}$/.test(s.numberPrefix)) { setMsg('Bill number prefix must be 1–6 letters or digits.'); return; }
    const badAccount = s.bankAccounts.findIndex((a) => !a.bankBin || !isValidAccount(a.accountNumber));
    if (badAccount >= 0) { setMsg(`Bank account ${badAccount + 1}: choose a bank and enter an account number with digits only (spaces, dots and dashes are fine).`); return; }
    if (!Number.isInteger(s.defaultPaymentDays) || s.defaultPaymentDays < 0) { setMsg('Payment days must be a whole number ≥ 0.'); return; }
    try {
      const keep = s.footerNotes.map((n, i) => ({ n: n.trim(), i })).filter((x) => x.n);
      const cleaned = { ...s, googleClientId: s.googleClientId.trim(), driveFolderName: s.driveFolderName.trim(), footerNotes: keep.map((x) => x.n), defaultFooterIndex: keep.findIndex((x) => x.i === s.defaultFooterIndex) };
      setS(cleaned);
      await putSettings(db, cleaned);
      await reloadSettings();
      setMsg('Saved.');
    } catch (e) {
      setMsg(`Could not save: ${String(e)}`);
    }
  };

  return (
    <div>
      <div class="page-head"><h2>Settings</h2><button class="btn" onClick={save}>Save</button></div>
      {msg && <p class={msg === 'Saved.' ? 'muted' : 'errors'}>{msg}</p>}
      <div class="panel"><h3>Your business</h3>
        <div class="grid2">
          {text('businessName', 'Business name (as printed)')}
          {text('taxId', 'Tax ID (MST)')}
          {text('address', 'Address')}
          {text('phone', 'Phone')}
          {text('email', 'Email')}
          {text('preparedBy', '"Prepared by" name')}
          <label class="field">Logo (optional, under 300 KB)
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.currentTarget.files?.[0])} />
          </label>
          {s.logoDataUrl && <div><img src={s.logoDataUrl} alt="" style="max-height:48px" /> <button class="btn ghost" onClick={() => set('logoDataUrl', null)}>Remove logo</button></div>}
        </div>
      </div>
      <div class="panel"><h3>Bank accounts for VietQR</h3>
        <p class="muted" style="margin-top:0">Choose one on each bill. The selected default is used for new bills.</p>
        {s.bankAccounts.map((a, i) => {
          const patch = (p: Partial<SavedBankAccount>) => set('bankAccounts', s.bankAccounts.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={a.id} class="grid2" style="align-items:end;border-top:1px solid var(--border);padding-top:10px;margin-bottom:10px">
              <label class="field">Bank
                <select value={a.bankBin} onChange={(e) => patch({ bankBin: e.currentTarget.value })}>
                  <option value="">— Choose —</option>
                  {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.shortName} – {b.name}</option>)}
                </select>
              </label>
              <label class="field">Account number<input value={a.accountNumber} onInput={(e) => patch({ accountNumber: e.currentTarget.value })} /></label>
              <label class="field">Account holder (as the bank shows it)<input value={a.accountHolder} onInput={(e) => patch({ accountHolder: e.currentTarget.value })} /></label>
              <div style="display:flex;gap:10px;align-items:center">
                <label><input type="radio" name="defaultBank" checked={s.defaultBankAccountId === a.id} onChange={() => set('defaultBankAccountId', a.id)} /> Default</label>
                <button class="btn ghost" onClick={() => {
                  const rest = s.bankAccounts.filter((x) => x.id !== a.id);
                  setS({ ...s, bankAccounts: rest, defaultBankAccountId: s.defaultBankAccountId === a.id ? (rest[0]?.id ?? '') : s.defaultBankAccountId });
                  setMsg('');
                }}>Remove</button>
              </div>
            </div>
          );
        })}
        <button class="btn ghost" onClick={() => {
          const a = { id: newId(), bankBin: '', accountNumber: '', accountHolder: '' };
          setS({ ...s, bankAccounts: [...s.bankAccounts, a], defaultBankAccountId: s.defaultBankAccountId || a.id });
          setMsg('');
        }}>+ Add bank account</button>
      </div>
      <div class="panel"><h3>Bill defaults</h3>
        <div class="grid2">
          {text('numberPrefix', 'Bill number prefix')}
          <label class="field">Default VAT
            <select value={String(s.defaultVatRate)} onChange={(e) => {
              const v = e.currentTarget.value;
              set('defaultVatRate', (v === 'none' ? 'none' : Number(v)) as VatRate);
            }}>
              {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
            </select>
          </label>
          <label class="field">Default payment days
            <input type="number" min={0} value={s.defaultPaymentDays} onInput={(e) => set('defaultPaymentDays', Number(e.currentTarget.value))} />
          </label>
        </div>
        <div class="field" style="margin-top:12px">Footer notes (pick one on each bill; the selected default is used for new bills)
          <label style="display:block;margin:6px 0">
            <input type="radio" name="defaultFooter" checked={s.defaultFooterIndex === -1} onChange={() => set('defaultFooterIndex', -1)} /> No footer by default
          </label>
          {s.footerNotes.map((n, i) => (
            <div key={i} style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
              <input type="radio" name="defaultFooter" title="Use for new bills" checked={s.defaultFooterIndex === i} onChange={() => set('defaultFooterIndex', i)} style="margin-top:10px" />
              <textarea rows={2} style="flex:1" value={n} onInput={(e) => set('footerNotes', s.footerNotes.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
              <button class="btn ghost" onClick={() => {
                const notes = s.footerNotes.filter((_, j) => j !== i);
                const d = s.defaultFooterIndex;
                setS({ ...s, footerNotes: notes, defaultFooterIndex: d === i ? -1 : d > i ? d - 1 : d });
                setMsg('');
              }}>Remove</button>
            </div>
          ))}
          <button class="btn ghost" onClick={() => set('footerNotes', [...s.footerNotes, ''])}>+ Add footer note</button>
        </div>
      </div>
      <div class="panel"><h3>Google Drive</h3>
        <p class="muted" style="margin-top:0">Save final bills as PDF to <b>My Drive / {s.driveFolderName || '…'} / year / customer</b>.{' '}
          <a href="https://github.com/anythingvn/billpayment/blob/main/docs/google-drive-setup.md" target="_blank" rel="noopener">How to set up</a></p>
        <div class="grid2">
          <label class="field">Google Client ID
            <input value={s.googleClientId} placeholder="….apps.googleusercontent.com" onInput={(e) => set('googleClientId', e.currentTarget.value)} />
          </label>
          <label class="field">Main folder name
            <input value={s.driveFolderName} onInput={(e) => set('driveFolderName', e.currentTarget.value)} />
          </label>
        </div>
        <label style="display:block;margin:10px 0">
          <input type="checkbox" checked={s.driveAutoUpload} onChange={(e) => set('driveAutoUpload', e.currentTarget.checked)} /> Upload automatically on export
        </label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          {drive
            ? <><span>{drive.email ? `Connected as ${drive.email}` : 'Connected'}</span><button class="btn ghost" onClick={disconnect}>Disconnect</button></>
            : <><button class="btn" disabled={!driveConfigured(settings)} onClick={connect}>Connect Google Drive</button>
              <span class="muted">{driveConfigured(settings) ? 'Not connected on this device' : 'Save a Client ID first'}</span></>}
        </div>
        {driveMsg && <p class="errors">{driveMsg}</p>}
      </div>
    </div>
  );
}
