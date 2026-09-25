export type VatRate = 'none' | 0 | 5 | 8 | 10;
export const VAT_RATES: VatRate[] = ['none', 0, 5, 8, 10];

export type BillStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export interface CustomerSnapshot {
  name: string;
  address: string;
  taxId: string;
  contactPerson: string;
  email: string;
  phone: string;
}

export interface Customer extends CustomerSnapshot {
  id: string;
  archived: boolean;
}

export interface Service {
  id: string;
  nameVi: string;
  nameEn: string;
  unitVi: string;
  unitEn: string;
  unitPrice: number;
  archived: boolean;
}

export interface BillLine {
  nameVi: string;
  nameEn: string;
  unitVi: string;
  unitEn: string;
  qty: number;
  unitPrice: number;
  /** Text-only notes printed under the service name; they never change amounts. */
  details: string[];
}

/** The account a bill is paid into (copied onto each bill). */
export interface BankAccount {
  bankBin: string;
  accountNumber: string;
  accountHolder: string;
}

export interface SavedBankAccount extends BankAccount {
  id: string;
}

export interface Bill {
  id: string;
  number: string;
  status: BillStatus;
  billDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  paidDate: string | null;
  customerId: string;
  customer: CustomerSnapshot;
  lines: BillLine[];
  vatRate: VatRate;
  /** Footer printed on this bill ('' = none). Missing on bills made before per-bill notes: show the Settings default. */
  footerNote?: string;
  /** Account chosen for this bill. Missing on bills made before per-bill accounts: use the Settings default. */
  bankAccount?: BankAccount;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Settings {
  businessName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  bankAccounts: SavedBankAccount[];
  /** id of the account new bills start with; '' when there are none. */
  defaultBankAccountId: string;
  preparedBy: string;
  numberPrefix: string;
  defaultVatRate: VatRate;
  defaultPaymentDays: number;
  /** Saved footer notes to pick from on each bill. */
  footerNotes: string[];
  /** Index into footerNotes used for new bills; -1 means no footer. */
  defaultFooterIndex: number;
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  logoDataUrl: null,
  bankAccounts: [],
  defaultBankAccountId: '',
  preparedBy: '',
  numberPrefix: 'TT',
  defaultVatRate: 8,
  defaultPaymentDays: 10,
  footerNotes: [
    'Hóa đơn GTGT điện tử sẽ được xuất sau khi thanh toán. / An official VAT e-invoice will be issued after payment.',
  ],
  defaultFooterIndex: 0,
};
