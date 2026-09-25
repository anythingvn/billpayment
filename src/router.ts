import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'home' }
  | { name: 'newBill' }
  | { name: 'bill'; id: string }
  | { name: 'editBill'; id: string }
  | { name: 'duplicateBill'; id: string }
  | { name: 'customers' }
  | { name: 'services' }
  | { name: 'settings' }
  | { name: 'backup' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'bills') {
    if (parts[1] === 'new' && parts.length === 2) return { name: 'newBill' };
    if (parts[1] && parts.length === 2) return { name: 'bill', id: parts[1] };
    if (parts[1] && parts[2] === 'edit') return { name: 'editBill', id: parts[1] };
    if (parts[1] && parts[2] === 'duplicate') return { name: 'duplicateBill', id: parts[1] };
  }
  if (parts.length === 1 && ['customers', 'services', 'settings', 'backup'].includes(parts[0])) {
    return { name: parts[0] } as Route;
  }
  return { name: 'home' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'newBill': return '#/bills/new';
    case 'bill': return `#/bills/${r.id}`;
    case 'editBill': return `#/bills/${r.id}/edit`;
    case 'duplicateBill': return `#/bills/${r.id}/duplicate`;
    default: return `#/${r.name}`;
  }
}

let guard: (() => boolean) | null = null;
/** A guard returns true when it is OK to leave the current screen. */
export function setNavigationGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

export function navigate(r: Route): void {
  if (guard && !guard()) return;
  guard = null;
  location.hash = routeToHash(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    let current = location.hash;
    const onChange = () => {
      if (location.hash === current) return;
      if (guard && !guard()) {
        // Browser back/forward with unsaved changes: put the old hash back.
        history.pushState(null, '', current);
        return;
      }
      guard = null;
      current = location.hash;
      setRoute(parseRoute(current));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
