import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app';
import { openAppDb, putCustomer, putSettings, putBill, listBills, getSettings } from '../../src/storage/db';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
async function setup(hash: string) {
  const db = await openAppDb(`app-db-${n++}`);
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', bankBin: '970436', accountNumber: '0071000123456' });
  await putCustomer(db, { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}

afterEach(() => {
  cleanup();
  location.hash = '';
});

describe('editor saving', () => {
  it('creates only one bill when Save draft is clicked twice quickly', async () => {
    const db = await setup('#/bills/new');
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    const save = await screen.findByText('Save draft');
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(location.hash).toBe('#/'));
    await new Promise((r) => setTimeout(r, 200)); // let any second save finish
    expect(await listBills(db)).toHaveLength(1);
  });

  it('refuses to save a draft whose price box is empty', async () => {
    const db = await setup('#/bills/new');
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    fireEvent.click(await screen.findByText('+ Custom line'));
    const price = document.querySelectorAll('input[type=number]')[1] as HTMLInputElement;
    fireEvent.input(price, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save draft'));
    expect(await screen.findByText(/Line 1: Unit price must be a whole number/)).toBeTruthy();
    expect(await listBills(db)).toHaveLength(0);
  });
});

describe('bill view for drafts', () => {
  it('sends drafts through the editor instead of offering Mark as sent / Export', async () => {
    const db = await openAppDb(`app-db-${n++}`);
    await putBill(db, sampleBill({ id: 'd1', status: 'draft', lines: [] }));
    location.hash = '#/bills/d1';
    render(<App db={db} initialSettings={await getSettings(db)} />);
    expect(await screen.findByText('Continue in editor')).toBeTruthy();
    expect(screen.queryByText('Mark as sent')).toBeNull();
    expect(screen.queryByText('Export PDF')).toBeNull();
  });
});
