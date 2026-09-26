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

/** Business details printed on a bill, copied onto the bill when it is sent. */
export interface BusinessSnapshot {
  businessName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  preparedBy: string;
}

/** Result of the last Google Drive upload of a bill. */
export interface DriveStatus {
  fileId: string | null;
  link: string | null;
  savedAt: string | null;
  error: string | null;
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
  /** Google Drive upload status; missing when never uploaded. */
  drive?: DriveStatus;
  /** Business details as sent; missing on drafts and on bills sent before this was saved (use Settings). */
  business?: BusinessSnapshot;
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
  /** OAuth Web client id for Google Drive; '' turns Drive features off. */
  googleClientId: string;
  driveFolderName: string;
  driveAutoUpload: boolean;
}

/**
 * The app's own Google OAuth Web client (public by design; only works on the registered origins
 * https://anythingvn.github.io and http://localhost:5173). Used unless Settings → Advanced sets another.
 */
export const BUILT_IN_GOOGLE_CLIENT_ID = '163028591701-sudv6ppv27fkj30rukboks15ujivtrv7.apps.googleusercontent.com';

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
  googleClientId: BUILT_IN_GOOGLE_CLIENT_ID,
  driveFolderName: 'Phiếu thanh toán',
  driveAutoUpload: true,
};
