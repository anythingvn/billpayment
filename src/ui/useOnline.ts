import { useEffect, useState } from 'preact/hooks';

export const NEEDS_CONNECTION = 'Needs a connection';
interface Connection { online: boolean; lastUpdated?: string }
let state: Connection = { online: true };
const listeners = new Set<(c: Connection) => void>();

/** Called by the ApiStore: online after a successful read, offline (with the offline copy's time) otherwise. */
export function setConnection(status: 'online' | 'offline', lastUpdated?: string): void {
  const next = { online: status === 'online', lastUpdated: status === 'online' ? undefined : lastUpdated };
  if (next.online === state.online && next.lastUpdated === state.lastUpdated) return;
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function useConnection(): Connection {
  const [c, setC] = useState(state);
  useEffect(() => {
    listeners.add(setC);
    setC(state);
    return () => { listeners.delete(setC); };
  }, []);
  return c;
}

/**
 * Props for a button that changes data or talks to the server: disabled while offline, with a tooltip.
 * `w(busy)` also disables it for the screen's own reason.
 */
export function useWrite(): (disabled?: boolean) => { disabled: boolean; title?: string } {
  const { online } = useConnection();
  return (disabled = false) => ({ disabled: !online || disabled, title: online ? undefined : NEEDS_CONNECTION });
}
