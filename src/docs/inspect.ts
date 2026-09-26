import { isKnownPlaceholder, suggestPlaceholder } from './catalog';

export const DELIMITERS: [string, string] = ['{', '}'];

export interface TemplateReport {
  used: string[];
  unknown: { name: string; suggestion: string | null }[];
  errors: string[];
}

/** The placeholder a template command refers to, or null for loop variables ($x.field) and END commands. */
function nameOf(type: string, code: string): string | null {
  const c = code.trim();
  if (type === 'FOR') return /\bIN\s+([A-Za-z_]\w*)/.exec(c)?.[1] ?? null;
  if (type.startsWith('END') || c.startsWith('$')) return null;
  return /^([A-Za-z_]\w*)/.exec(c)?.[1] ?? null;
}

/** Lists the placeholders a .docx template uses, the unknown ones (with a suggestion), and unbalanced FOR/IF. */
export async function inspectTemplate(template: ArrayBuffer): Promise<TemplateReport> {
  const { listCommands } = await import('docx-templates');
  let commands: { type: string; code: string }[];
  try {
    commands = await listCommands(template, DELIMITERS);
  } catch (e) {
    return { used: [], unknown: [], errors: [`The template can't be read: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const used = new Set<string>();
  const errors: string[] = [];
  const open: { kind: 'FOR' | 'IF'; code: string }[] = [];
  for (const { type, code } of commands) {
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
    errors,
  };
}
