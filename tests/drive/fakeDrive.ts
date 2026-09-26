import type { DriveApi, DriveFile } from '../../src/drive/api';

const FOLDER = 'application/vnd.google-apps.folder';
type Stored = DriveFile & { mime: string; content?: Blob; versions: number };

/** In-memory Drive with the same interface as createDriveApi; records calls. */
export function fakeDrive(): DriveApi & { files: Map<string, Stored>; calls: string[]; byName(name: string): Stored[] } {
  const files = new Map<string, Stored>();
  const calls: string[] = [];
  let n = 0;
  const link = (id: string) => `https://drive.google.com/file/d/${id}/view`;
  const pub = (f: Stored): DriveFile => ({ id: f.id, name: f.name, parents: [...(f.parents ?? [])], webViewLink: f.webViewLink });
  return {
    files,
    calls,
    byName: (name) => [...files.values()].filter((f) => f.name === name),
    async getFile(id) {
      calls.push(`getFile ${id}`);
      const f = files.get(id);
      return f && !f.trashed ? pub(f) : null;
    },
    async findFolder(name, parentId) {
      calls.push(`findFolder ${name}`);
      return [...files.values()].find((f) => f.mime === FOLDER && f.name === name && f.parents?.[0] === parentId && !f.trashed)?.id ?? null;
    },
    async createFolder(name, parentId) {
      calls.push(`createFolder ${name}`);
      const id = `id${++n}`;
      files.set(id, { id, name, parents: [parentId], mime: FOLDER, versions: 1 });
      return id;
    },
    async createFile(name, parentId, blob, mimeType) {
      calls.push(`createFile ${name}`);
      const id = `id${++n}`;
      const f: Stored = { id, name, parents: [parentId], mime: mimeType, content: blob, webViewLink: link(id), versions: 1 };
      files.set(id, f);
      return pub(f);
    },
    async updateFile(id, name, blob, _mimeType, move) {
      calls.push(`updateFile ${id}`);
      const f = files.get(id);
      if (!f) throw new Error('not found');
      f.name = name;
      f.content = blob;
      f.versions++;
      if (move) f.parents = [move.to];
      return pub(f);
    },
    async aboutEmail() {
      calls.push('aboutEmail');
      return 'owner@example.com';
    },
  };
}
