import { createContext, useContext } from "react";

// WP15a F12: Clerk opnieuw starten. Clerk biedt geen load() om opnieuw te
// proberen; App.tsx mount de ClerkProvider opnieuw (nieuwe key), waarna
// load() opnieuw loopt.
export const ClerkRestartContext = createContext<() => void>(() => {});

export function useRestartClerk(): () => void {
  return useContext(ClerkRestartContext);
}
