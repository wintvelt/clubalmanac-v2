import { createContext, useContext } from "react";
import type { SessionState } from "../lib/sessionState";

// De sessie-toestand van de poort (src/AuthGate.tsx), voor het toegangspad en
// de guards. Buiten de poort is het "loading": dan loopt er niets live.
export const AuthStateContext = createContext<SessionState>("loading");

export function useAuthState(): SessionState {
  return useContext(AuthStateContext);
}

// In "reconnecting" (F1, F8, F16): netwerk, of er een poging loopt en of die
// over zijn time-out is, en hoe start je er een.
export type Reconnect = {
  online: boolean | null;
  retrying: boolean;
  retryTimedOut: boolean;
  retry: () => void;
};

export const ReconnectContext = createContext<Reconnect>({
  online: null,
  retrying: false,
  retryTimedOut: false,
  retry: () => {},
});

export function useReconnect(): Reconnect {
  return useContext(ReconnectContext);
}
