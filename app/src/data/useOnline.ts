import { useNetworkState } from "expo-network";

// Heeft het toestel netwerk (WP15a F1)? null = nog onbekend, en dat telt als
// niet online. Verbonden zonder internet telt als offline.
export function useOnline(): boolean | null {
  const { isConnected, isInternetReachable } = useNetworkState();
  if (isConnected === undefined) return null;
  return isConnected && isInternetReachable !== false;
}
