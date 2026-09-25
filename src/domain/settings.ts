import { DEFAULT_SETTINGS, type Settings } from './types';

/** Fills in defaults and converts settings saved by older versions (a single `footerNote`) to the footer note list. */
export function normalizeSettings(stored: Record<string, unknown> | undefined): Settings {
  const { footerNote, ...rest } = stored ?? {};
  const s = { ...DEFAULT_SETTINGS, ...rest } as Settings;
  if (typeof footerNote === 'string' && !('footerNotes' in rest)) {
    s.footerNotes = footerNote.trim() ? [footerNote] : [];
    s.defaultFooterIndex = footerNote.trim() ? 0 : -1;
  }
  if (!Number.isInteger(s.defaultFooterIndex) || s.defaultFooterIndex >= s.footerNotes.length) s.defaultFooterIndex = -1;
  return s;
}

/** The footer text a new bill starts with. */
export function defaultFooterText(s: Settings): string {
  return s.footerNotes[s.defaultFooterIndex] ?? '';
}
