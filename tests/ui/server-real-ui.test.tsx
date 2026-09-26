import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app';
import { realServerStore } from '../storage/realServer';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const s = { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false,
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1' };
afterEach(() => { cleanup(); location.hash = ''; });

describe('I1: saving twice on one screen (real server)', () => {
  it('Mark as paid, then Undo paid', async () => {
    const { store } = await realServerStore();
    await store.putSettings(s);
    await store.putBill(sampleBill({ id: 'b1', status: 'sent' }));
    location.hash = '#/bills/b1';
    render(<App db={store} initialSettings={await store.getSettings()} />);
    fireEvent.click(await screen.findByText('Mark as paid'));
    await screen.findByText('Undo paid');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Undo paid'));
    await waitFor(async () => expect((await store.getBill('b1'))!.status).toBe('sent'));
    expect(screen.queryByText(/ConflictError|Someone else changed/)).toBeNull();
  });

  it('Settings saved twice', async () => {
    const { store } = await realServerStore();
    await store.putSettings(s);
    location.hash = '#/settings';
    render(<App db={store} initialSettings={await store.getSettings()} />);
    const name = (await screen.findByLabelText(/Business name/)) as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Sao Mai 1' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(async () => expect((await store.getSettings()).businessName).toBe('Sao Mai 1'));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.input(screen.getByLabelText(/Business name/), { target: { value: 'Sao Mai 2' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(async () => expect((await store.getSettings()).businessName).toBe('Sao Mai 2'));
  });
});
