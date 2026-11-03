import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../convexApi";
import type { SessionState } from "../lib/sessionState";
import { shouldRecordVisit } from "../lib/visit";
import { useAppState } from "./useAppState";

type Moment = { appState: string; authState: SessionState };

// WP15b invarianten 5 en 12: registreer een bezoek bij elke overgang naar
// "actief en ingelogd", hoogstens één poging per periode per user (zie
// src/lib/visit.ts). Elke poging telt, ook een mislukte: geen lus. Een fout
// ziet de user niet. Schrijft niets wat een live query leest (invariant 6).
export function useRecordVisit(authState: SessionState, userId: string | null) {
  const appState = useAppState();
  const recordVisit = useMutation(api.users.recordVisit);
  // Begint niet-live, zodat een koude start of een nieuwe sessie telt.
  const previous = useRef<Moment>({ appState: "unknown", authState: "loading" });
  const lastAttempt = useRef<{ userId: string; at: number } | null>(null);

  useEffect(() => {
    const current = { appState, authState };
    const now = Date.now();
    const due = shouldRecordVisit({
      previous: previous.current,
      current,
      userId,
      now,
      lastAttempt: lastAttempt.current,
    });
    previous.current = current;
    if (!due || userId === null) return;
    lastAttempt.current = { userId, at: now };
    recordVisit({}).catch(() => {});
  }, [appState, authState, userId, recordVisit]);
}
