import { useSyncExternalStore } from "react";

// Loopt er een verzoek van de login (WP15a F23)? Vanaf de tik op "Stuur code"
// staat signIn.status nog even op needs_identifier; de poort leest dit om dan
// Clerk niet te herstarten. useEmailCodeLogin zet het, AuthGate leest het.
let running = false;
const listeners = new Set<() => void>();

export function setLoginRequestRunning(value: boolean) {
  if (running === value) return;
  running = value;
  listeners.forEach((listener) => listener());
}

export function useLoginRequestRunning(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => running,
  );
}
