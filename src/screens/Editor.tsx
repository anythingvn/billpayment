export type EditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string };
export function Editor({ mode }: { mode: EditorMode }) { return <h2>Editor ({mode.kind})</h2>; }
