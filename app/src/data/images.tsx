import { useAuth } from "@clerk/expo";
import { Image, type ImageSource } from "expo-image";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  photoImageUrl,
  profileImageUrl,
  siteUrlOf,
  type ImageFormat,
} from "../lib/imageUrls";

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

// Hetzelfde token als de Convex-client (src/data/convexConnection.tsx): de
// JWT-template "convex", tenzij de sessie zelf al voor Convex is. Clerk houdt
// het token in een cache en ververst het zelf. `attempt` haalt opnieuw op,
// na een mislukt beeld (een verlopen token geeft 401).
function useConvexToken(attempt: number): string | null | undefined {
  const { isSignedIn, getToken, sessionClaims } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const forConvex = sessionClaims?.aud === "convex";
  useEffect(() => {
    let current = true;
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    const fetch = forConvex ? getToken({ skipCache: attempt > 0 }) : getToken({ template: "convex", skipCache: attempt > 0 });
    void fetch.then(
      (t) => current && setToken(t),
      () => current && setToken(null),
    );
    return () => {
      current = false;
    };
    // getToken van Clerk is niet gememoïseerd (zie convexConnection).
  }, [isSignedIn, forConvex, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return token;
}

// De bron van een foto, of `undefined` zolang het token er nog niet is, of
// `null` zonder token (dan toont de plek zijn fout-toestand). De cache-sleutel
// is de URL: bij een nieuw token laadt het beeld niet opnieuw.
export function usePhotoSource(
  photoId: string,
  format: ImageFormat,
  attempt = 0,
): ImageSource | null | undefined {
  const site = useSiteUrl();
  const token = useConvexToken(attempt);
  if (site === null || token === null) return null;
  if (token === undefined) return undefined;
  const uri = photoImageUrl(site, photoId, format);
  return { uri, cacheKey: uri, headers: { Authorization: `Bearer ${token}` } };
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
