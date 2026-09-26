import { PLACEHOLDERS, isKnownPlaceholder, suggestPlaceholder } from './catalog';
import type { DocKind } from '../domain/types';

export const DELIMITERS: [string, string] = ['{', '}'];

export interface TemplateReport {
  used: string[];
  unknown: { name: string; suggestion: string | null }[];
  /** Known placeholders that this kind of document doesn't fill (they print empty). */
  unavailable: string[];
  errors: string[];
}

export const GRAMMAR_ERROR = 'Only simple placeholders are allowed';

// Templates may only use these command shapes, so no template can run code in the app (render uses noSandbox).
const NAME = '[A-Za-z_]\\w*';
const REF = `(?:${NAME}|\\$${NAME}\\.${NAME})`;
const GRAMMAR: Record<string, RegExp> = {
  INS: new RegExp(`^${REF}$`),
  IMAGE: /^(?:qr|logo)\(\)$/,
  FOR: new RegExp(`^${NAME}\\s+IN\\s+${NAME}$`),
  'END-FOR': new RegExp(`^(?:${NAME})?$`),
  IF: new RegExp(`^!?${REF}$`),
  'END-IF': new RegExp(`^(?:!?${REF})?$`),
};

/** The placeholder a template command refers to, or null for loop variables ($x.field) and END commands. */
function nameOf(type: string, code: string): string | null {
  const c = code.trim();
  if (type === 'FOR') return /\bIN\s+([A-Za-z_]\w*)/.exec(c)?.[1] ?? null;
  if (type.startsWith('END') || c.startsWith('$')) return null;
  return /^([A-Za-z_]\w*)/.exec(c)?.[1] ?? null;
}

/** Lists the placeholders a .docx template uses, the unknown ones (with a suggestion), and unbalanced FOR/IF. */
export async function inspectTemplate(template: ArrayBuffer, kind?: DocKind): Promise<TemplateReport> {
  const { listCommands } = await import('docx-templates/lib/browser.js');
  let commands: { type: string; code: string }[];
  try {
    // The browser bundle's zip reader wants a plain byte array (a Node Buffer or a view of one fails).
    commands = await listCommands(new Uint8Array(template) as unknown as ArrayBuffer, DELIMITERS);
  } catch (e) {
    return { used: [], unknown: [], unavailable: [], errors: [`The template can't be read: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const used = new Set<string>();
  const errors: string[] = [];
  const open: { kind: 'FOR' | 'IF'; code: string }[] = [];
  for (const { type, code } of commands) {
    if (!GRAMMAR[type]?.test(code.trim())) {
      errors.push(`${GRAMMAR_ERROR}: {${type === 'INS' ? '' : `${type} `}${code.trim()}}`);
      continue;
    }
    const name = nameOf(type, code);
    if (name) used.add(name);
    if (type === 'FOR' || type === 'IF') open.push({ kind: type, code: code.trim() });
    if (type === 'END-FOR' || type === 'END-IF') {
      const i = open.map((o) => o.kind).lastIndexOf(type === 'END-FOR' ? 'FOR' : 'IF');
      if (i >= 0) open.splice(i, 1);
      else errors.push(`${type} has no matching ${type === 'END-FOR' ? 'FOR' : 'IF'}`);
    }
  }
  for (const o of open) errors.push(`${o.kind} ${o.code} has no matching END-${o.kind}`);
  const names = [...used];
  return {
    used: names,
    unknown: names.filter((n) => !isKnownPlaceholder(n)).map((name) => ({ name, suggestion: suggestPlaceholder(name) })),
    unavailable: kind ? names.filter((n) => PLACEHOLDERS.some((p) => p.key === n && !p.kinds.includes(kind))) : [],
    errors,
  };
}
