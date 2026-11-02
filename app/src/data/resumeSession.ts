import { useAuth, useClerk } from "@clerk/expo";
import { useEffect } from "react";

// F12: start Clerk offline zonder resource-cache, dan laadt hij een lege
// client (status "degraded"), en ziet de user het inlogscherm. Clerk haalt de
// echte client later zelf op, maar maakt de sessie daarin dan niet actief
// (clerk-js 6.40.1: updateClient kiest alleen een sessie als er nog geen
// client was). Dat doet deze hook: alleen in "degraded", en alleen voor de
// sessie die de client zelf als laatst actief noemt. Na uitloggen is die er
// niet (WP13 invariant 6).
export function useResumeSession() {
  const clerk = useClerk();
  const { isSignedIn } = useAuth();
  const client = clerk.client;
  const lastId = client?.lastActiveSessionId ?? null;
  const sessionId =
    clerk.status === "degraded" &&
    isSignedIn === false &&
    lastId !== null &&
    client?.signedInSessions.some((s) => s.id === lastId)
      ? lastId
      : null;
  useEffect(() => {
    if (sessionId) clerk.setActive({ session: sessionId }).catch(() => {});
  }, [clerk, sessionId]);
}
