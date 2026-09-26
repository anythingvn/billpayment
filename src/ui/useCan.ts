import { useApp } from '../app';
import { can, type Action } from '../domain/permissions';

/** What the signed-in user's role allows. The single-user app (no server) allows everything. */
export function useCan(): (action: Action) => boolean {
  const { user, auth } = useApp();
  return (action) => !auth || !user || can(user.role, action);
}
