import { useConnection } from './useOnline';

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "Offline — viewing only · last updated hh:mm" while the server can't be reached. */
export function OfflineBanner() {
  const { online, lastUpdated } = useConnection();
  if (online) return null;
  return <div class="offline-banner" role="status">{`Offline — viewing only${lastUpdated ? ` · last updated ${hhmm(lastUpdated)}` : ''}`}</div>;
}
