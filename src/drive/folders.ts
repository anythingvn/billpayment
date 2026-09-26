import type { DriveApi } from './api';

/**
 * Finds or creates the folder chain `names` under My Drive and returns the deepest folder id.
 * `cache` maps "a/b/c" paths to folder ids; stale ids (deleted, trashed, other account) are replaced.
 */
export async function ensureFolderPath(
  api: DriveApi,
  names: string[],
  cache: Record<string, string>,
): Promise<{ folderId: string; cache: Record<string, string> }> {
  const next = { ...cache };
  let parent = 'root';
  for (let i = 0; i < names.length; i++) {
    const key = names.slice(0, i + 1).join('/');
    const cached = next[key];
    const found = cached ? await api.getFile(cached) : null;
    // Only trust a cached folder that still exists under the expected parent.
    let id = found && (parent === 'root' || !found.parents || found.parents.includes(parent)) ? found.id : null;
    if (!id) id = (await api.findFolder(names[i], parent)) ?? (await api.createFolder(names[i], parent));
    next[key] = id;
    parent = id;
  }
  return { folderId: parent, cache: next };
}
