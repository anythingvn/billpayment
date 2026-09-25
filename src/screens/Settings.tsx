import { useState } from 'preact/hooks';
import { useApp } from '../app';
import { putSettings } from '../storage/db';
import { BANKS } from '../domain/banks';
import { isValidAccount } from '../domain/vietqr';
import { VAT_RATES, type Settings, type VatRate } from '../domain/types';

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

  const save = async () => {
    if (!/^[A-Za-z0-9]{1,6}$/.test(s.numberPrefix)) { setMsg('Bill number prefix must be 1–6 letters or digits.'); return; }
    if (s.accountNumber.trim() && !isValidAccount(s.accountNumber)) { setMsg('Account number must contain only digits (spaces, dots and dashes are fine).'); return; }
    if (!Number.isInteger(s.defaultPaymentDays) || s.defaultPaymentDays < 0) { setMsg('Payment days must be a whole number ≥ 0.'); return; }
    try {
      await putSettings(db, s);
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
      <div class="panel"><h3>Bank for VietQR</h3>
        <div class="grid2">
          <label class="field">Bank
            <select value={s.bankBin} onChange={(e) => set('bankBin', e.currentTarget.value)}>
              <option value="">— Choose —</option>
              {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.shortName} – {b.name}</option>)}
            </select>
          </label>
          {text('accountNumber', 'Account number')}
          {text('accountHolder', 'Account holder (as the bank shows it)')}
        </div>
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
        <label class="field" style="margin-top:12px">Footer note on bills (leave empty for none)
          <textarea rows={2} value={s.footerNote} onInput={(e) => set('footerNote', e.currentTarget.value)} />
        </label>
      </div>
    </div>
  );
}
