import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';

export interface ListReturnContext {
  readonly listPath: string;
  readonly itemId: string;
}

interface ListReturnState {
  readonly listReturn: ListReturnContext;
}

export function listReturnContext(listPath: string, itemId: string): ListReturnState {
  return { listReturn: { listPath, itemId } };
}

export function listPathFor(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export function returnContextFromState(state: unknown): ListReturnContext | null {
  if (typeof state !== 'object' || state === null || !('listReturn' in state)) return null;
  const candidate = state.listReturn;
  if (typeof candidate !== 'object' || candidate === null) return null;
  if (!('listPath' in candidate) || !('itemId' in candidate)) return null;
  if (typeof candidate.listPath !== 'string' || typeof candidate.itemId !== 'string') return null;
  if (!candidate.listPath.startsWith('/') || candidate.listPath.startsWith('//')) return null;
  return { listPath: candidate.listPath, itemId: candidate.itemId };
}

/** Restores the interactive list control, rather than a fragile pixel offset, after a write. */
export function useReturnedListItem<T extends HTMLElement>(
  ready: boolean,
): [string | null, RefObject<T | null>] {
  const location = useLocation();
  const navigate = useNavigate();
  const context = returnContextFromState(location.state as unknown);
  const target = useRef<T>(null);

  useEffect(() => {
    if (context === null || !ready) return;
    target.current?.scrollIntoView({ block: 'center' });
    target.current?.focus();
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
  }, [context, location.pathname, location.search, navigate, ready]);

  return [context?.itemId ?? null, target];
}
