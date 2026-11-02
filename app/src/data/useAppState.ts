import { useEffect, useState } from "react";
import { AppState } from "react-native";

// De huidige AppState-waarde als string, zoals React Native hem geeft. De
// beslissing wat "actief" is, staat in src/lib/liveQuery.ts.
export function useAppState(): string {
  const [state, setState] = useState<string>(() => String(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setState(String(next)));
    // Kan veranderd zijn tussen de eerste render en het abonnement.
    setState(String(AppState.currentState));
    return () => sub.remove();
  }, []);
  return state;
}
