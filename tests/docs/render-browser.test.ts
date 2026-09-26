import vm from 'node:vm';
import { renderDocx } from '../../src/docs/render';
import { makeDocx, docxText } from './makeDocx';

// In the browser build Node's `vm` is an empty stub (Vite externalizes it), so rendering must not need it.
describe('renderDocx without Node vm (browser)', () => {
  const Script = vm.Script;
  beforeAll(() => { (vm as { Script?: unknown }).Script = undefined; });
  afterAll(() => { vm.Script = Script; });

  it('renders placeholders', async () => {
    const blob = await renderDocx(await makeDocx(['Số: {so_hop_dong}']), { so_hop_dong: '12/2026/HĐDV-SM' }, {});
    expect(await docxText(blob)).toContain('Số: 12/2026/HĐDV-SM');
  });
});
