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

export type ContractStatus = 'draft' | 'active' | 'completed' | 'terminated';
export type ContractKind = 'contract' | 'addendum';
export type AddendumEffect = 'addsWork' | 'changesTerms';
export type InstalmentShare = { percent: number } | { amount: number };
export type InstalmentDue = { on: 'signing' } | { on: 'acceptance' } | { on: 'date'; date: string };

export interface Instalment {
  id: string;
  name: string;
  share: InstalmentShare;
  due: InstalmentDue;
  /** Acceptance instalments: marked ready to bill, and the day that happened. */
  ready: boolean;
  readyOn: string | null;
}

export interface PeriodicPlan {
  type: 'periodic';
  every: 'month' | 'quarter';
  /** Amount per period, before VAT. */
  amount: number;
  /** First and last period, YYYY-MM (a quarter uses its first month). */
  first: string;
  last: string;
}

export type Plan = { type: 'instalments'; items: Instalment[] } | PeriodicPlan | { type: 'perUse' };

/** A contract or an addendum (phụ lục), which is a contract record pointing to its parent. */
export interface Contract {
  id: string;
  kind: ContractKind;
  parentId: string | null;
  effect: AddendumEffect | null;
  /** changesTerms addenda: the date the new terms apply from. */
  effectiveDate: string | null;
  number: string;
  title: string;
  status: ContractStatus;
  signedDate: string;
  startDate: string;
  endDate: string | null;
  customerId: string;
  customer: CustomerSnapshot;
  /** Copied when the contract is activated. */
  business: BusinessSnapshot | null;
  lines: BillLine[];
  vatRate: VatRate;
  plan: Plan;
  paymentTerms: string;
  paymentDays: number;
  /** Word template for the contract document; null = the default contract template. */
  templateId: string | null;
  /** Google Drive status of the contract's Word document. */
  drive?: DriveStatus;
  createdAt: string;
  updatedAt: string;
}

export type DocKind = 'contract' | 'addendum' | 'bill';

/** An uploaded Word (.docx) template with {placeholders}. */
export interface DocTemplate {
  id: string;
  kind: DocKind;
  name: string;
  fileName: string;
  data: ArrayBuffer;
  uploadedAt: string;
  /** Contract templates: the one new contracts use. */
  isDefault: boolean;
}

/** A bill's link to the contract/addendum it bills, with numbers and dates copied at save for printing. */
export interface ContractRef {
  contractId: string;
  /** Instalment id or period key (YYYY-MM); null = not a specific item. */
  itemKey: string | null;
  number: string;
  signedDate: string;
  parentNumber: string | null;
  parentSignedDate: string | null;
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
  /** The contract or addendum this bill is for. */
  contractRef?: ContractRef;
  /** Google Drive status of the bill's Word document (drive = the PDF). */
  driveDocx?: DriveStatus;
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
  /** Contract number parts: {n}/{YYYY}/{contractType}[-{contractSuffix}]. */
  contractType: string;
  contractSuffix: string;
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
  contractType: 'HĐDV',
  contractSuffix: '',
};
