import { useAuth } from "@clerk/expo";
import { Image, type ImageSource } from "expo-image";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  photoImageUrl,
  profileImageUrl,
  siteUrlOf,
  type ImageFormat,
} from "../lib/imageUrls";
import {
  imageFailed,
  imageLoadView,
  initialImageLoad,
  retryByUser,
  tokenArrived,
  tokenRequest,
  type ImageLoad,
} from "../lib/imageRetry";

// WP17a: bronnen voor beelden uit het beeldpad (besluit 1). Een foto vraagt
// het Clerk-token voor Convex in de Authorization-header; het beeldpad checkt
// bij elk verzoek de toegang. Een profielfoto is openbaar (besluit 8).

const SiteUrl = createContext<string | null>(null);

export function ImageHostProvider({ convexUrl, children }: { convexUrl: string; children: ReactNode }) {
  return <SiteUrl value={siteUrlOf(convexUrl)}>{children}</SiteUrl>;
}

function useSiteUrl(): string | null {
  return useContext(SiteUrl);
}

// Een foto-beeld met het Clerk-token, via de toestand van src/lib/imageRetry
// (invariant 18). Hetzelfde token als de Convex-client
// (src/data/convexConnection.tsx): de JWT-template "convex", tenzij de sessie
// zelf al voor Convex is. Clerk houdt het token in een cache; na een fout
// haalt de herhaling een vers token (skipCache), want een verlopen token
// geeft 401. Er gaat geen verzoek uit tot het token van de huidige poging er
// is; een laat token van een eerdere poging telt niet.
//
// `source`: de bron, `undefined` zolang het token er nog niet is, `null` als
// het beeld terugvalt (fout-tegel of letter). `attempt` is de key van het
// beeld: een nieuwe poging bouwt het opnieuw op. De cache-sleutel is de URL,
// dus een nieuw token alleen laadt het beeld niet opnieuw.
export function usePhotoLoad(photoId: string, format: ImageFormat) {
  const site = useSiteUrl();
  const { isSignedIn, getToken, sessionClaims } = useAuth();
  const forConvex = sessionClaims?.aud === "convex";
  const [load, setLoad] = useState<ImageLoad>(initialImageLoad);
  const request = tokenRequest(load);
  const requestAttempt = request?.attempt;
  const skipCache = request?.skipCache ?? false;
  useEffect(() => {
    if (requestAttempt === undefined) return;
    const arrived = (token: string | null) => setLoad((s) => tokenArrived(s, requestAttempt, token));
    if (!isSignedIn) {
      arrived(null);
      return;
    }
    const fetch = forConvex ? getToken({ skipCache }) : getToken({ template: "convex", skipCache });
    void fetch.then(
      (token) => arrived(token ?? null),
      () => arrived(null),
    );
    // getToken van Clerk is niet gememoïseerd (zie convexConnection).
  }, [requestAttempt, skipCache, isSignedIn, forConvex]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = imageLoadView(load);
  let source: ImageSource | null | undefined;
  if (site === null || view.kind === "failed") source = null;
  else if (view.kind === "wait") source = undefined;
  else {
    const uri = photoImageUrl(site, photoId, format);
    source = { uri, cacheKey: uri, headers: { Authorization: `Bearer ${view.token}` } };
  }
  const attempt = view.kind === "load" ? view.attempt : load.attempt;
  return {
    source,
    attempt,
    // Het beeld van deze poging laadde niet.
    onError: () => setLoad((s) => imageFailed(s, attempt)),
    // "Opnieuw" op de fout-tegel.
    retry: () => setLoad((s) => retryByUser(s)),
  };
}

export function useProfileSource(userId: string, format: ImageFormat): ImageSource | null {
  const site = useSiteUrl();
  if (site === null) return null;
  return { uri: profileImageUrl(site, userId, format) };
}

// Besluit 3: de beeldcache op het toestel gaat weg bij uitloggen, net als de
// opslag van Clerk. De cache-sleutel is de URL, niet de user: zonder wissen
// zou de volgende user op dit toestel de beelden van de vorige kunnen zien.
export async function wipeImageCache(): Promise<boolean> {
  const results = await Promise.all([
    Image.clearMemoryCache().catch(() => false),
    Image.clearDiskCache().catch(() => false),
  ]);
  return results.every(Boolean);
}
