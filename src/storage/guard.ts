import type { Store } from './store';
import { ConflictError, ForbiddenError, HandledError, InvalidError, OfflineError, ServerError, SignInError } from './errors';

export type StoreProblem = SignInError | OfflineError | ConflictError | InvalidError | ServerError | ForbiddenError;
const isProblem = (e: unknown): e is StoreProblem => e instanceof SignInError || e instanceof OfflineError || e instanceof ConflictError
  || e instanceof InvalidError || e instanceof ServerError || e instanceof ForbiddenError;

/**
 * Wraps a server-backed Store so a failed call is reported once, app-wide (message, Reload, or sign-in), instead of
 * each screen handling it. The call then fails with a HandledError: screens finish (busy states reset, so the user can
 * retry), keep their input, and don't show the problem a second time.
 */
export function guardStore(store: Store, report: (e: StoreProblem) => void): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const out = (target as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop as string](...args);
        if (!(out instanceof Promise)) return out;
        return out.catch((e: unknown) => {
          if (!isProblem(e)) throw e;
          report(e);
          throw new HandledError(e);
        });
      };
    },
  });
}
