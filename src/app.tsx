import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { AppDb } from './storage/db';
import { getSettings } from './storage/db';
import type { Settings } from './domain/types';
import { navigate, useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { BillView } from './screens/BillView';
import { Editor } from './screens/Editor';
import { Customers } from './screens/Customers';
import { Services } from './screens/Services';
import { SettingsScreen } from './screens/Settings';
import { BackupScreen } from './screens/Backup';
import { Contracts } from './screens/Contracts';
import { ContractEditor } from './screens/ContractEditor';
import { ContractView } from './screens/ContractView';
import { Reports } from './screens/Reports';
import { StatementScreen } from './screens/Statement';
import { ErrorBoundary } from './ui/ErrorBoundary';

interface AppCtx {
  db: AppDb;
  settings: Settings;
  reloadSettings(): Promise<void>;
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(Ctx)!;

const NAV: { label: string; route: Route; match: Route['name'][] }[] = [
  { label: 'Bills', route: { name: 'home' }, match: ['home', 'bill', 'newBill', 'editBill', 'duplicateBill', 'newBillFromContract'] },
  { label: 'Contracts', route: { name: 'contracts' }, match: ['contracts', 'newContract', 'contract', 'editContract', 'newAddendum'] },
  { label: 'Reports', route: { name: 'reports' }, match: ['reports'] },
  { label: 'Customers', route: { name: 'customers' }, match: ['customers', 'customerStatement'] },
  { label: 'Services', route: { name: 'services' }, match: ['services'] },
  { label: 'Settings', route: { name: 'settings' }, match: ['settings'] },
  { label: 'Backup / Restore', route: { name: 'backup' }, match: ['backup'] },
];

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <Home />;
    case 'bill': return <BillView id={route.id} />;
    case 'newBill': return <Editor key="new" mode={{ kind: 'new' }} />;
    case 'editBill': return <Editor key={`e-${route.id}`} mode={{ kind: 'edit', id: route.id }} />;
    case 'duplicateBill': return <Editor key={`d-${route.id}`} mode={{ kind: 'duplicate', id: route.id }} />;
    case 'customers': return <Customers />;
    case 'customerStatement': return <StatementScreen key={route.id} id={route.id} />;
    case 'services': return <Services />;
    case 'settings': return <SettingsScreen />;
    case 'backup': return <BackupScreen />;
    case 'reports': return <Reports />;
    case 'contracts': return <Contracts />;
    case 'newContract': return <ContractEditor key="new-contract" mode={{ kind: 'new' }} />;
    case 'editContract': return <ContractEditor key={`ec-${route.id}`} mode={{ kind: 'edit', id: route.id }} />;
    case 'newAddendum': return <ContractEditor key={`na-${route.parentId}`} mode={{ kind: 'addendum', parentId: route.parentId }} />;
    case 'contract': return <ContractView key={route.id} id={route.id} />;
    case 'newBillFromContract': return <Editor key={`fc-${route.contractId}-${route.itemKey}`} mode={{ kind: 'fromContract', contractId: route.contractId, itemKey: route.itemKey }} />;
  }
}

export function App({ db, initialSettings }: { db: AppDb; initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const route = useRoute();
  const reloadSettings = async () => setSettings(await getSettings(db));
  return (
    <Ctx.Provider value={{ db, settings, reloadSettings }}>
      <div class="layout">
        <nav class="nav">
          <h1>Phiếu thanh toán</h1>
          {NAV.map((n) => (
            <button key={n.label} class={n.match.includes(route.name) ? 'on' : ''} onClick={() => navigate(n.route)}>
              {n.label}
            </button>
          ))}
        </nav>
        <main class="main">
          <ErrorBoundary key={location.hash}>
            <Screen route={route} />
          </ErrorBoundary>
        </main>
      </div>
    </Ctx.Provider>
  );
}
