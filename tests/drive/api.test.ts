import { createDriveApi, DriveError } from '../../src/drive/api';

type Req = { url: string; init: RequestInit };
function fakeFetch(responses: (Response | Error)[]) {
  const reqs: Req[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    reqs.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no response queued');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, reqs };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = (...t: string[]) => {
  const calls: unknown[] = [];
  const getToken = async (o?: { refresh?: boolean }) => { calls.push(o); return t[Math.min(calls.length - 1, t.length - 1)]; };
  return { getToken, calls };
};

describe('Drive REST client', () => {
  it('findFolder escapes quotes and returns the first id or null', async () => {
    const f = fakeFetch([json({ files: [{ id: 'F1' }, { id: 'F2' }] }), json({ files: [] })]);
    const api = createDriveApi(tokens('t1').getToken, f.fn);
    expect(await api.findFolder("Nhà hàng Mama's", 'root')).toBe('F1');
    const q = new URL(f.reqs[0].url).searchParams.get('q');
    expect(q).toBe("name = 'Nhà hàng Mama\\'s' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false");
    expect(await api.findFolder('X', 'P')).toBeNull();
  });
  it('sends the bearer token', async () => {
    const f = fakeFetch([json({ user: { emailAddress: 'a@b.c' } })]);
    const api = createDriveApi(tokens('t1').getToken, f.fn);
    expect(await api.aboutEmail()).toBe('a@b.c');
    expect(new Headers(f.reqs[0].init.headers).get('Authorization')).toBe('Bearer t1');
  });
  it('refreshes once on 401', async () => {
    const t = tokens('old', 'new');
    const f = fakeFetch([json({}, 401), json({ id: 'D1', name: 'x' })]);
    const api = createDriveApi(t.getToken, f.fn);
    expect(await api.getFile('D1')).toMatchObject({ id: 'D1' });
    expect(t.calls[1]).toEqual({ refresh: true });
    expect(new Headers(f.reqs[1].init.headers).get('Authorization')).toBe('Bearer new');
    const f2 = fakeFetch([json({}, 401), json({}, 401)]);
    await expect(createDriveApi(tokens('a', 'b').getToken, f2.fn).getFile('x')).rejects.toMatchObject({ kind: 'auth' });
  });
  it('maps errors', async () => {
    const api = (r: (Response | Error)[]) => createDriveApi(tokens('t').getToken, fakeFetch(r).fn);
    expect(await api([json({}, 404)]).getFile('x')).toBeNull();
    await expect(api([new TypeError('Failed to fetch')]).getFile('x')).rejects.toMatchObject({ kind: 'offline' });
    const e = await api([json({ error: { message: 'boom' } }, 500)]).createFolder('a', 'root').catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect(e.kind).toBe('other');
  });
  it('getFile returns null for trashed files', async () => {
    const api = createDriveApi(tokens('t').getToken, fakeFetch([json({ id: 'x', name: 'n', trashed: true })]).fn);
    expect(await api.getFile('x')).toBeNull();
  });
  it('createFolder posts folder metadata under the parent', async () => {
    const f = fakeFetch([json({ id: 'NEW' })]);
    expect(await createDriveApi(tokens('t').getToken, f.fn).createFolder('2026', 'P1')).toBe('NEW');
    expect(f.reqs[0].init.method).toBe('POST');
    expect(JSON.parse(String(f.reqs[0].init.body))).toEqual({ name: '2026', mimeType: 'application/vnd.google-apps.folder', parents: ['P1'] });
  });
  it('createFile uploads multipart PDF into the parent', async () => {
    const f = fakeFetch([json({ id: 'P', name: 'a.pdf', parents: ['F'], webViewLink: 'https://drive.google.com/file/d/P/view' })]);
    const file = await createDriveApi(tokens('t').getToken, f.fn).createFile('a.pdf', 'F', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'application/pdf');
    expect(file.webViewLink).toContain('/P/');
    const u = new URL(f.reqs[0].url);
    expect(u.pathname).toBe('/upload/drive/v3/files');
    expect(u.searchParams.get('uploadType')).toBe('multipart');
    const body = await (f.reqs[0].init.body as Blob).text();
    expect(new Headers(f.reqs[0].init.headers).get('Content-Type')).toMatch(/^multipart\/related; boundary=/);
    expect(body).toContain('"name":"a.pdf"');
    expect(body).toContain('"parents":["F"]');
    expect(body).toContain('%PDF-1.4');
  });
  it('updateFile adds move params', async () => {
    const f = fakeFetch([json({ id: 'P', name: 'a.pdf', parents: ['b'] })]);
    await createDriveApi(tokens('t').getToken, f.fn).updateFile('P', 'a.pdf', new Blob(['x']), 'application/pdf', { from: 'a', to: 'b' });
    const u = new URL(f.reqs[0].url);
    expect(f.reqs[0].init.method).toBe('PATCH');
    expect([u.pathname, u.searchParams.get('addParents'), u.searchParams.get('removeParents')]).toEqual(['/upload/drive/v3/files/P', 'b', 'a']);
  });
});

describe('stalled requests', () => {
  it('passes a timeout signal and reports a stalled request plainly', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const fn = (async (_u: string, init: RequestInit) => { seen.push(init.signal); throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof fetch;
    const e = await createDriveApi(async () => 't', fn).getFile('x').catch((x) => x);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect([e.kind, e.message]).toEqual(['other', 'Google Drive did not respond. Try again.']);
  });
});

describe('any file type', () => {
  it('createFile sends the given MIME type', async () => {
    const f = fakeFetch([json({ id: 'W', name: 'a.docx', parents: ['F'] })]);
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await createDriveApi(tokens('t').getToken, f.fn).createFile('a.docx', 'F', new Blob(['PK']), DOCX);
    const body = await (f.reqs[0].init.body as Blob).text();
    expect(body).toContain(`"mimeType":"${DOCX}"`);
    expect(body).toContain(`Content-Type: ${DOCX}`);
  });
});
