import { normalizeSettings, defaultFooterText } from '../../src/domain/settings';
import { DEFAULT_SETTINGS, BUILT_IN_GOOGLE_CLIENT_ID } from '../../src/domain/types';

describe('normalizeSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it('turns an old single footer note into a one-item list that is the default', () => {
    const s = normalizeSettings({ businessName: 'Sao Mai', footerNote: 'Cảm ơn quý khách' });
    expect(s.footerNotes).toEqual(['Cảm ơn quý khách']);
    expect(s.defaultFooterIndex).toBe(0);
    expect('footerNote' in s).toBe(false);
    expect(s.businessName).toBe('Sao Mai');
  });
  it('turns an old empty footer note into an empty list with no default', () => {
    const s = normalizeSettings({ footerNote: '' });
    expect(s.footerNotes).toEqual([]);
    expect(s.defaultFooterIndex).toBe(-1);
  });
  it('resets a default index that points outside the list', () => {
    expect(normalizeSettings({ footerNotes: ['A'], defaultFooterIndex: 3 }).defaultFooterIndex).toBe(-1);
  });
});

describe('defaultFooterText', () => {
  it('gives the chosen default note, or empty for None', () => {
    expect(defaultFooterText({ ...DEFAULT_SETTINGS, footerNotes: ['A', 'B'], defaultFooterIndex: 1 })).toBe('B');
    expect(defaultFooterText({ ...DEFAULT_SETTINGS, footerNotes: ['A'], defaultFooterIndex: -1 })).toBe('');
  });
});

describe('bank accounts', () => {
  it('turns the old single account into a one-item list that is the default', async () => {
    const { defaultBankAccount } = await import('../../src/domain/settings');
    const s = normalizeSettings({ bankBin: '970436', accountNumber: '0071 0001 23456', accountHolder: 'SAO MAI' });
    expect(s.bankAccounts).toEqual([{ id: 'acc-1', bankBin: '970436', accountNumber: '0071 0001 23456', accountHolder: 'SAO MAI' }]);
    expect(s.defaultBankAccountId).toBe('acc-1');
    expect(['bankBin', 'accountNumber', 'accountHolder'].some((k) => k in s)).toBe(false);
    expect(defaultBankAccount(s)).toEqual({ bankBin: '970436', accountNumber: '0071 0001 23456', accountHolder: 'SAO MAI' });
  });
  it('makes no account from old empty bank fields', () => {
    const s = normalizeSettings({ bankBin: '', accountNumber: '', accountHolder: '' });
    expect([s.bankAccounts, s.defaultBankAccountId]).toEqual([[], '']);
  });
  it('falls back to the first account when the default id is missing', () => {
    const accounts = [{ id: 'x', bankBin: '970436', accountNumber: '1', accountHolder: '' }];
    expect(normalizeSettings({ bankAccounts: accounts, defaultBankAccountId: 'gone' }).defaultBankAccountId).toBe('x');
  });
});

describe('Google Drive settings', () => {
  it('adds Drive defaults to older settings, using the built-in Client ID', () => {
    const s = normalizeSettings({ businessName: 'X' });
    expect([s.googleClientId, s.driveFolderName, s.driveAutoUpload]).toEqual([BUILT_IN_GOOGLE_CLIENT_ID, 'Phiếu thanh toán', true]);
    expect(BUILT_IN_GOOGLE_CLIENT_ID).toBe('163028591701-sudv6ppv27fkj30rukboks15ujivtrv7.apps.googleusercontent.com');
  });
  it('falls back to the built-in Client ID when none was saved, but keeps a custom one', () => {
    expect(normalizeSettings({ googleClientId: '' }).googleClientId).toBe(BUILT_IN_GOOGLE_CLIENT_ID);
    expect(normalizeSettings({ googleClientId: '  ' }).googleClientId).toBe(BUILT_IN_GOOGLE_CLIENT_ID);
    expect(normalizeSettings({ googleClientId: 'mine.apps.googleusercontent.com' }).googleClientId).toBe('mine.apps.googleusercontent.com');
  });
});

describe('contract settings', () => {
  it('defaults the contract number type and suffix', () => {
    const s = normalizeSettings({});
    expect([s.contractType, s.contractSuffix]).toEqual(['HĐDV', '']);
  });
});
