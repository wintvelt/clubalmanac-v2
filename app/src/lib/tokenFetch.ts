// WP15a F9: alleen de laatst gestarte tokenophaal telt. Clerk's getToken
// probeert zelf opnieuw met backoff, dus pogingen overlappen. Een late uitkomst
// van een oude poging verandert niets; een poging die nog loopt ook niet; dan
// geldt de vorige uitkomst.

export type TokenFetchState = { readonly latest: number; readonly failed: boolean };

export const initialTokenFetch: TokenFetchState = { latest: 0, failed: false };

export function startTokenFetch(state: TokenFetchState): { state: TokenFetchState; id: number } {
  const id = state.latest + 1;
  return { state: { ...state, latest: id }, id };
}

export function finishTokenFetch(state: TokenFetchState, id: number, ok: boolean): TokenFetchState {
  return id === state.latest ? { ...state, failed: !ok } : state;
}

export function tokenFetchFailed(state: TokenFetchState): boolean {
  return state.failed;
}
