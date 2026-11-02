import { useNetworkState } from "expo-network";
import { createContext, useContext, type ReactNode } from "react";

// Heeft het toestel netwerk (WP15a F1)? null = nog onbekend, en dat telt als
// niet online. Verbonden zonder internet telt als offline.
//
// Gemeten boven Clerk (App.tsx). Mount de app Clerk opnieuw (F12), dan blijft
// de laatste meting staan: geen sprong van "onbekend" naar "online" die als
// terugkeer van het netwerk telt, en dus geen lus.
const OnlineContext = createContext<boolean | null>(null);

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { isConnected, isInternetReachable } = useNetworkState();
  const online = isConnected === undefined ? null : isConnected && isInternetReachable !== false;
  return <OnlineContext value={online}>{children}</OnlineContext>;
}

export function useOnline(): boolean | null {
  return useContext(OnlineContext);
}
