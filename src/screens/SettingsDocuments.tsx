import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { listContracts, listTemplates, newId, putTemplate, removeTemplate } from '../storage/db';
import { MAX_TEMPLATE_BYTES } from '../storage/backup';
import { inspectTemplate, type TemplateReport } from '../docs/inspect';
import { PLACEHOLDERS, isKnownPlaceholder, type PlaceholderInfo } from '../docs/catalog';
import { loadStarter } from '../docs/starters';
import { downloadBlob } from '../docs/download';
import { formatDateVn } from '../domain/format';
import type { DocKind, DocTemplate } from '../domain/types';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const KIND_LABEL: Record<DocKind, string> = { contract: 'contract', addendum: 'addendum', bill: 'bill', statement: 'statement' };
const STARTER_NAME: Record<DocKind, string> = { contract: 'Hợp đồng mẫu', addendum: 'Addendum', bill: 'Bill', statement: 'Statement' };
const GROUP_LABEL: Record<PlaceholderInfo['group'], string> = {
  benA: 'Party A (your business)', benB: 'Party B (customer)', contract: 'Contract', addendum: 'Addendum',
  bill: 'Bill', statement: 'Customer statement', tables: 'Tables (repeat per row)', flags: 'Conditions (IF … END-IF)', images: 'Images',
};

/** The exact text to type into Word for a placeholder. */
export function copyText(p: PlaceholderInfo): string {
  if (p.group === 'flags') return `{IF ${p.key}}`;
  if (p.group === 'images') return `{IMAGE ${p.key}()}`;
  if (p.group === 'tables') {
    const [table, field] = p.key.split('.');
    const v = /FOR (\w+) IN/.exec(PLACEHOLDERS.find((x) => x.key === table)!.example)![1];
    return field ? `{$${v}.${field}}` : `{FOR ${v} IN ${table}}`;
  }
  return `{${p.key}}`;
}

/** Report lines for the placeholders a template uses, unknown ones and syntax errors. */
function reportLines(r: TemplateReport, kind?: DocKind): string[] {
  return [
    ...r.errors,
    ...r.unknown.map((u) => `Unknown placeholder: ${u.name}${u.suggestion ? ` (did you mean ${u.suggestion}?)` : ''}`),
    ...(kind ? r.unavailable.map((n) => `${n} isn't filled in ${KIND_LABEL[kind]} documents (it prints empty)`) : []),
  ];
}

async function readDocx(file: File): Promise<ArrayBuffer> {
  const data = await file.arrayBuffer();
  const b = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error("This isn't a Word .docx file");
  if (data.byteLength > MAX_TEMPLATE_BYTES) throw new Error('The template is larger than 5 MB');
  return data;
}

const unreadable = (r: TemplateReport) => r.errors.some((e) => e.startsWith("The template can't be read"));

export function SettingsDocuments() {
  const { db } = useApp();
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [newName, setNewName] = useState('');
  const [msgs, setMsgs] = useState<string[]>([]);
  const [info, setInfo] = useState('');
  const [check, setCheck] = useState<{ report: TemplateReport; lines: string[] } | null>(null);
  const reload = async () => setTemplates(await listTemplates(db));
  useEffect(() => { reload(); }, []);

  const contracts = templates.filter((t) => t.kind === 'contract').sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const slot = (kind: DocKind) => templates.find((t) => t.kind === kind) ?? null;

  const report = (lines: string[], ok = '') => { setMsgs(lines); setInfo(ok); };

  /** Saves bytes as a template: replacing `existing`, or a new one (the first contract template becomes the default). */
  async function save(kind: DocKind, data: ArrayBuffer, fileName: string, name: string, existing: DocTemplate | null) {
    const r = await inspectTemplate(data, kind);
    if (unreadable(r)) return report(r.errors);
    const isFirstContract = kind === 'contract' && !templates.some((t) => t.kind === 'contract');
    await putTemplate(db, {
      id: existing?.id ?? newId(), kind, name: existing?.name ?? name, fileName, data, uploadedAt: new Date().toISOString(),
      isDefault: existing?.isDefault ?? isFirstContract,
    });
    await reload();
    report(reportLines(r, kind), `Saved “${existing?.name ?? name}”.`);
  }

  async function upload(kind: DocKind, e: Event, existing: DocTemplate | null) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const data = await readDocx(file);
      const name = kind === 'contract' ? newName.trim() || file.name.replace(/\.docx$/i, '') : STARTER_NAME[kind];
      await save(kind, data, file.name, name, existing ?? (kind === 'contract' ? null : slot(kind)));
      if (kind === 'contract' && !existing) setNewName('');
    } catch (err) {
      report([err instanceof Error ? err.message : String(err)]);
    }
  }

  async function useStarter(kind: DocKind) {
    // The contract starter replaces an earlier copy of itself instead of piling up "Hợp đồng mẫu" templates.
    const current = kind === 'contract' ? contracts.find((t) => t.fileName === 'starter-contract.docx') ?? null : slot(kind);
    if (current && !confirm(`Replace the current ${KIND_LABEL[kind]} template “${current.name}” with the starter?`)) return;
    try {
      await save(kind, await loadStarter(kind), `starter-${kind}.docx`, STARTER_NAME[kind], current);
    } catch (err) {
      report([err instanceof Error ? err.message : String(err)]);
    }
  }

  async function downloadStarter(kind: DocKind) {
    try {
      downloadBlob(new Blob([await loadStarter(kind)], { type: DOCX_MIME }), `starter-${kind}.docx`);
    } catch (err) {
      report([err instanceof Error ? err.message : String(err)]);
    }
  }

  async function remove(t: DocTemplate) {
    const using = t.kind === 'contract' ? (await listContracts(db)).filter((c) => c.templateId === t.id).length : 0;
    const question = using === 1 ? '1 contract uses this template; it will use the default. Remove it?'
      : using > 1 ? `${using} contracts use this template; they will use the default. Remove it?`
        : `Remove the template “${t.name}”?`;
    if (!confirm(question)) return;
    await removeTemplate(db, t.id);
    await reload();
    report([], `Removed “${t.name}”.`);
  }

  async function rename(t: DocTemplate) {
    const name = prompt('Template name', t.name)?.trim();
    if (!name) return;
    await putTemplate(db, { ...t, name });
    await reload();
  }

  async function checkFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const r = await inspectTemplate(await readDocx(file));
      setCheck({ report: r, lines: reportLines(r) });
    } catch (err) {
      setCheck({ report: { used: [], unknown: [], unavailable: [], errors: [] }, lines: [err instanceof Error ? err.message : String(err)] });
    }
  }

  const download = (t: DocTemplate) => downloadBlob(new Blob([t.data], { type: DOCX_MIME }), t.fileName);
  const uploaded = (t: DocTemplate) => formatDateVn(t.uploadedAt.slice(0, 10));
  const fileButton = (label: string, text: string, onChange: (e: Event) => void) => (
    <label class="btn ghost" style="display:inline-block">{text}
      <input type="file" accept=".docx" aria-label={label} style="display:none" onChange={onChange} />
    </label>
  );

  return (
    <div class="panel"><h3>Documents (Word templates)</h3>
      <p class="muted" style="margin-top:0">Only upload templates you created or trust — templates can contain small formulas that run in this app.</p>
      {(msgs.length > 0 || info) && (
        <div class={msgs.length ? 'errors' : 'muted'}>
          {info && msgs.length > 0 && <p style="margin:0 0 4px">{info}</p>}
          {msgs.map((m) => <p key={m} style="margin:0">{m}</p>)}
          {!msgs.length && info}
        </div>
      )}

      <h4>Contract templates</h4>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>Default</th><th>Name</th><th>File</th><th>Uploaded</th><th /></tr></thead>
        <tbody>
          {contracts.map((t) => (
            <tr key={t.id}>
              <td><input type="radio" name="default-contract-template" aria-label="Default" checked={t.isDefault}
                onChange={async () => { await putTemplate(db, { ...t, isDefault: true }); await reload(); }} /></td>
              <td>{t.name}</td>
              <td class="muted">{t.fileName}</td>
              <td>{uploaded(t)}</td>
              <td style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn ghost" onClick={() => rename(t)}>Rename</button>
                <button class="btn ghost" onClick={() => download(t)}>Download</button>
                {fileButton(`Replace ${t.name}`, 'Replace', (e) => upload('contract', e, t))}
                <button class="btn ghost" onClick={() => remove(t)}>Remove</button>
              </td>
            </tr>
          ))}
          {contracts.length === 0 && <tr><td colSpan={5} class="muted">No contract templates yet.</td></tr>}
        </tbody>
      </table></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <input placeholder="Name, e.g. Hợp đồng thiết kế" aria-label="New contract template name" value={newName}
          onInput={(e) => setNewName(e.currentTarget.value)} style="padding:8px;border:1px solid var(--border);border-radius:6px" />
        {fileButton('Upload contract template', '+ Upload contract template', (e) => upload('contract', e, null))}
      </div>

      {(['addendum', 'bill', 'statement'] as const).map((kind) => {
        const t = slot(kind);
        return (
          <div key={kind}>
            <h4>{{ addendum: 'Addendum template', bill: 'Bill template', statement: 'Statement template' }[kind]}</h4>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              {t ? <span>{t.fileName} <span class="muted">· {uploaded(t)}</span></span> : <span class="muted">None</span>}
              {fileButton(`Upload ${kind} template`, t ? 'Replace' : 'Upload', (e) => upload(kind, e, t))}
              {t && <button class="btn ghost" onClick={() => download(t)}>Download</button>}
              {t && <button class="btn ghost" onClick={() => remove(t)}>Remove</button>}
            </div>
          </div>
        );
      })}

      <h4>Starter templates</h4>
      <div class="table-scroll"><table class="list">
        <tbody>
          {(['contract', 'addendum', 'bill', 'statement'] as const).map((kind) => (
            <tr key={kind}>
              <td style="text-transform:capitalize">{KIND_LABEL[kind]}</td>
              <td style="display:flex;gap:6px">
                <button class="btn ghost" onClick={() => downloadStarter(kind)}>Download</button>
                <button class="btn ghost" aria-label={`Use starter ${kind} template`} onClick={() => useStarter(kind)}>Use starter</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <h4>Check a template</h4>
      {fileButton('Check a template', 'Choose a .docx to check…', checkFile)}
      {check && (
        <div style="margin-top:8px">
          {check.report.used.length > 0 && (
            <ul class="checked-names">
              {check.report.used.map((n) => (isKnownPlaceholder(n)
                ? <li key={n} class="known">✓ {n}</li>
                : <li key={n} class="unknown">✗ {n}</li>))}
            </ul>
          )}
          {check.lines.map((l) => <p key={l} class="errors" style="margin:4px 0">{l}</p>)}
          {check.lines.length === 0 && <p>✓ No problems found.</p>}
        </div>
      )}

      <details style="margin-top:12px">
        <summary>Placeholders</summary>
        {(Object.keys(GROUP_LABEL) as PlaceholderInfo['group'][]).map((g) => (
          <div key={g}>
            <h4>{GROUP_LABEL[g]}</h4>
            <div class="table-scroll"><table class="list">
              <tbody>
                {PLACEHOLDERS.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key}>
                    <td><code>{p.key}</code></td>
                    <td>{p.vi}<br /><span class="muted">{p.en}</span></td>
                    <td class="muted">{p.example}</td>
                    <td><button class="btn ghost" onClick={() => navigator.clipboard?.writeText(copyText(p))}>Copy</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        ))}
      </details>
    </div>
  );
}
