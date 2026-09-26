import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

vi.mock('../../src/ui/useQrDataUrl', () => ({
  useQrDataUrl: () => null,
  qrToDataUrl: vi.fn(async () => { throw new Error('qr failed'); }),
}));

import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putCustomer, listBills } from '../../src/storage/db';
import { DEFAULT_SETTINGS } from '../../src/domain/types';

afterEach(() => { cleanup(); location.hash = ''; });

describe('QR failure during Save & export', () => {
  it('shows a clear error instead of failing silently', async () => {
    const db = await openAppDb('export-qr-0');
    await putSettings(db, {
      ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false,
      bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
    });
    await putCustomer(db, { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    location.hash = '#/bills/new';
    render(<App db={db} initialSettings={await getSettings(db)} />);
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    fireEvent.click(await screen.findByText('+ Custom line'));
    fireEvent.input(screen.getByPlaceholderText('Tên dịch vụ'), { target: { value: 'Thiết kế' } });
    fireEvent.input(document.querySelectorAll('input[type=number]')[1], { target: { value: '1000' } });
    fireEvent.click(screen.getByText('3 · Review & export'));
    fireEvent.click(await screen.findByText('Save & export PDF'));
    expect(await screen.findByText(/QR code could not be created/)).toBeTruthy();
    await waitFor(async () => expect((await listBills(db))[0]?.status).toBe('sent'));
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});
