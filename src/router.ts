import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'home' }
  | { name: 'newBill' }
  | { name: 'bill'; id: string }
  | { name: 'editBill'; id: string }
  | { name: 'duplicateBill'; id: string }
  | { name: 'customers' }
  | { name: 'customerStatement'; id: string }
  | { name: 'services' }
  | { name: 'settings' }
  | { name: 'backup' }
  | { name: 'reports' }
  | { name: 'contracts' }
  | { name: 'newContract' }
  | { name: 'contract'; id: string }
  | { name: 'editContract'; id: string }
  | { name: 'newAddendum'; parentId: string }
  | { name: 'newBillFromContract'; contractId: string; itemKey: string | null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'bills') {
    if (parts[1] === 'new' && parts.length === 2) return { name: 'newBill' };
    if (parts[1] === 'new' && parts[2] === 'contract' && parts[3] && parts.length <= 5) {
      return { name: 'newBillFromContract', contractId: decodeURIComponent(parts[3]), itemKey: parts[4] ? decodeURIComponent(parts[4]) : null };
    }
    if (parts[1] && parts.length === 2) return { name: 'bill', id: parts[1] };
    if (parts[1] && parts[2] === 'edit') return { name: 'editBill', id: parts[1] };
    if (parts[1] && parts[2] === 'duplicate') return { name: 'duplicateBill', id: parts[1] };
  }
  if (parts[0] === 'contracts') {
    if (parts.length === 1) return { name: 'contracts' };
    if (parts[1] === 'new' && parts.length === 2) return { name: 'newContract' };
    const id = decodeURIComponent(parts[1]);
    if (parts.length === 2) return { name: 'contract', id };
    if (parts[2] === 'edit') return { name: 'editContract', id };
    if (parts[2] === 'addendum') return { name: 'newAddendum', parentId: id };
  }
  if (parts[0] === 'customers' && parts[1] && parts[2] === 'statement' && parts.length === 3) {
    return { name: 'customerStatement', id: decodeURIComponent(parts[1]) };
  }
  if (parts.length === 1 && ['customers', 'services', 'settings', 'backup', 'reports'].includes(parts[0])) {
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
    case 'newContract': return '#/contracts/new';
    case 'contract': return `#/contracts/${encodeURIComponent(r.id)}`;
    case 'editContract': return `#/contracts/${encodeURIComponent(r.id)}/edit`;
    case 'newAddendum': return `#/contracts/${encodeURIComponent(r.parentId)}/addendum`;
    case 'customerStatement': return `#/customers/${encodeURIComponent(r.id)}/statement`;
    case 'newBillFromContract':
      return `#/bills/new/contract/${encodeURIComponent(r.contractId)}${r.itemKey ? `/${encodeURIComponent(r.itemKey)}` : ''}`;
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
