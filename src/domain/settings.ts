import { BUILT_IN_GOOGLE_CLIENT_ID, DEFAULT_SETTINGS, type BankAccount, type BusinessSnapshot, type Settings } from './types';

/** Fills in defaults and converts settings saved by older versions (a single `footerNote`) to the footer note list. */
export function normalizeSettings(stored: Record<string, unknown> | undefined): Settings {
  const { footerNote, bankBin, accountNumber, accountHolder, ...rest } = stored ?? {};
  const s = { ...DEFAULT_SETTINGS, ...rest } as Settings;
  if (typeof footerNote === 'string' && !('footerNotes' in rest)) {
    s.footerNotes = footerNote.trim() ? [footerNote] : [];
    s.defaultFooterIndex = footerNote.trim() ? 0 : -1;
  }
  if (!('bankAccounts' in rest)) {
    const old = { bankBin: String(bankBin ?? ''), accountNumber: String(accountNumber ?? ''), accountHolder: String(accountHolder ?? '') };
    const hasOld = Object.values(old).some((v) => v.trim());
    s.bankAccounts = hasOld ? [{ id: 'acc-1', ...old }] : [];
    s.defaultBankAccountId = hasOld ? 'acc-1' : '';
  }
  if (!s.bankAccounts.some((a) => a.id === s.defaultBankAccountId)) s.defaultBankAccountId = s.bankAccounts[0]?.id ?? '';
  if (typeof s.googleClientId !== 'string' || !s.googleClientId.trim()) s.googleClientId = BUILT_IN_GOOGLE_CLIENT_ID;
  if (!Number.isInteger(s.defaultFooterIndex) || s.defaultFooterIndex >= s.footerNotes.length) s.defaultFooterIndex = -1;
  return s;
}

/** The footer text a new bill starts with. */
export function defaultFooterText(s: Settings): string {
  return s.footerNotes[s.defaultFooterIndex] ?? '';
}

/** A copy of the default account (without its id), or undefined when there are no accounts. */
export function defaultBankAccount(s: Settings): BankAccount | undefined {
  const a = s.bankAccounts.find((x) => x.id === s.defaultBankAccountId);
  return a && { bankBin: a.bankBin, accountNumber: a.accountNumber, accountHolder: a.accountHolder };
}

/** The account a bill is paid into: its own copy, or the default for bills made before per-bill accounts. */
export function billBankAccount(bill: { bankAccount?: BankAccount }, s: Settings): BankAccount | undefined {
  return bill.bankAccount ?? defaultBankAccount(s);
}

/** Business details as they are now, to copy onto a sent bill or an activated contract. */
export function businessSnapshot(s: Settings): BusinessSnapshot {
  const { businessName, taxId, address, phone, email, logoDataUrl, preparedBy } = s;
  return { businessName, taxId, address, phone, email, logoDataUrl, preparedBy };
}
