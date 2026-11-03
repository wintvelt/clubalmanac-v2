import { useNetworkState } from "expo-network";
import { createContext, useContext, type ReactNode } from "react";

// Heeft het toestel netwerk (WP15a F1)? null = nog onbekend, en dat telt als
// niet online. Verbonden zonder internet telt als offline.
//
// Een herstart van Clerk herlaadt de app (src/data/clerkRestart.ts), en dan
// begint ook deze meting opnieuw bij "onbekend". De poort telt die eerste
// meting niet als terugkeer van het netwerk (AuthGate, useRetryOnReturn), dus
// geen lus.
const OnlineContext = createContext<boolean | null>(null);

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { isConnected, isInternetReachable } = useNetworkState();
  const online = isConnected === undefined ? null : isConnected && isInternetReachable !== false;
  return <OnlineContext value={online}>{children}</OnlineContext>;
}

export function useOnline(): boolean | null {
  return useContext(OnlineContext);
}
