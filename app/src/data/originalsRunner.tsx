import { useAuth } from "@clerk/expo";
import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useMemo } from "react";
import { originalUploaderAvailable } from "../../modules/clubalmanac-video";
import { api } from "../convexApi";
import { nudgeOriginals, setOriginalsSession, startOriginals } from "./originals";
import { useAppState } from "./useAppState";

// WP38b 38b-4: de wachtrij met originelen draait vanuit de wortel van de app
// (src/app/_layout.tsx), ook als iOS de app op de achtergrond start; niet
// vanuit een scherm. Dit onderdeel geeft de runner (src/data/originals.ts)
// de aanroepen (`startOriginal`, `finishOriginal`) en wie er is ingelogd.
// Aanroepen alleen met een sessie bij Clerk én Convex; uitgelogd pauzeert de
// runner (en wist niets). In de webapp en in een build zonder uploader doet
// het niets.
export function OriginalsRunner() {
  if (!originalUploaderAvailable) return null;
  return <Runner />;
}

function Runner() {
  const startOriginal = useAction(api.filmProjects.startOriginal);
  const finishOriginal = useAction(api.filmProjects.finishOriginal);
  const client = useMemo(() => ({ startOriginal, finishOriginal }), [startOriginal, finishOriginal]);
  const { isSignedIn, userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const appState = useAppState();
  const sessionUser = isSignedIn === true && isAuthenticated && userId ? userId : null;

  useEffect(() => {
    startOriginals();
  }, []);

  useEffect(() => {
    setOriginalsSession(client, sessionUser);
    return () => setOriginalsSession(null, null);
  }, [client, sessionUser]);

  // Wekkers lopen niet op de achtergrond: bij terugkomst opnieuw kijken.
  useEffect(() => {
    if (appState === "active") nudgeOriginals();
  }, [appState]);

  return null;
}
