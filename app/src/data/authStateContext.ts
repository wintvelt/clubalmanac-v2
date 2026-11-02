import { createContext, useContext } from "react";
import type { AuthState } from "../lib/authState";

// De auth-toestand van de poort (src/AuthGate.tsx), voor het toegangspad.
// Buiten de poort is het "loading": dan loopt er niets live.
export const AuthStateContext = createContext<AuthState>("loading");

export function useAuthState(): AuthState {
  return useContext(AuthStateContext);
}
