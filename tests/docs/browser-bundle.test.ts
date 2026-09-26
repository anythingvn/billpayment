import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// docx-templates' Node entry needs Node's vm, Buffer and stream, which Vite stubs out: in the browser every document
// failed ("vm.Script is not a constructor", "Buffer is not defined"). Node tests can't see that, so pin the import.
describe('docx-templates is loaded from its browser bundle', () => {
  const dir = join(__dirname, '../../src');
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [join(d, e.name)] : []));
  it('no source file imports the Node entry', () => {
    const offenders = files(dir).filter((f) => /from 'docx-templates'|import\('docx-templates'\)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
