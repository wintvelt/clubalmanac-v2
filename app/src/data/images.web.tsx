import { useAuth } from "@clerk/expo";
import type { ImageSource } from "expo-image";
import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from "react";
import { createImageMemory, imageMemoryKey, type ImageMemoryKind } from "../lib/imageMemory";
import { webImageMemoryLimit } from "../lib/wideLayout";
import {
  inviteCoverUrl,
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

// WP35 A-invariant W3 (route A, besluit B1): de web-variant van
// src/data/images.tsx, met dezelfde exports. Een `<img>` stuurt geen
// `Authorization`-header mee, en het token hoort nooit in een URL. Daarom haalt
// de app een foto of uitnodigingscover zelf op met `fetch`, met het Clerk-token
// in de header en zonder de HTTP-cache van de browser (`no-store`: niets op
// schijf). De bytes gaan als `blob:`-URL in een begrensd geheugen
// (src/lib/imageMemory.ts): bij de grens gaat het langst niet gebruikte beeld
// eruit en wordt zijn URL vrijgegeven. De sleutel bevat de user, dus een
// volgende user in deze browser krijgt nooit een beeld van de vorige.
// Uitloggen leegt het geheugen (`wipeImageCache`).
//
// Niet de header-route van expo-image: die haalt opnieuw op bij elk nieuw
// source-object, geeft zijn `blob:`-URL's nooit vrij en gebruikt de
// HTTP-cache (spec §Vraag 1).
//
// De toestand van een poging (token, één herhaling met een vers token na een
// fout) is dezelfde als op iOS: src/lib/imageRetry.ts. `fetch` geeft de
// status, dus een 401 met een verlopen token leidt tot een vers token.

// De grens volgt het scherm: alles wat de albumlijst tegelijk rendert, past er
// ruim in (src/lib/wideLayout.ts). Het scherm verandert niet tijdens een sessie;
// het venster wel, maar dat is nooit groter dan het scherm.
const MEMORY_LIMIT = webImageMemoryLimit(
  typeof screen === "undefined" ? 0 : screen.width,
  typeof screen === "undefined" ? 0 : screen.height,
);

type Held = { url: string };

const memory = createImageMemory<Held>({
  limit: MEMORY_LIMIT,
  release: (held) => URL.revokeObjectURL(held.url),
});

// Elke wis verhoogt de generatie: een ophaling die tijdens het uitloggen nog
// liep, legt daarna niets meer in het geheugen.
let generation = 0;

const SiteUrl = createContext<string | null>(null);

export function ImageHostProvider({ convexUrl, children }: { convexUrl: string; children: ReactNode }) {
  return <SiteUrl value={siteUrlOf(convexUrl)}>{children}</SiteUrl>;
}

export function useSiteUrl(): string | null {
  return useContext(SiteUrl);
}

export function usePhotoLoad(photoId: string, format: ImageFormat, hasFormats?: boolean) {
  // WP25 A-invariant 26: zonder formaten geeft het pad het origineel onder
  // dezelfde URL; met `hasFormats` in de sleutel komt dat nooit terug als formaat.
  const variant = `${format}#${hasFormats === true ? "formaat" : "origineel"}`;
  return useTokenImageLoad("foto", photoId, variant, (site) => photoImageUrl(site, photoId, format));
}

export function useInviteCoverLoad(inviteId: string, format: ImageFormat) {
  return useTokenImageLoad("uitnodiging", inviteId, format, (site) => inviteCoverUrl(site, inviteId, format));
}

function useTokenImageLoad(
  kind: ImageMemoryKind,
  id: string,
  variant: string,
  urlFor: (site: string) => string,
) {
  const site = useSiteUrl();
  const { isSignedIn, userId, getToken, sessionClaims } = useAuth();
  const forConvex = sessionClaims?.aud === "convex";
  const [load, setLoad] = useState<ImageLoad>(initialImageLoad);
  // Na een nieuw beeld in het geheugen opnieuw renderen.
  const [, stored] = useReducer((n: number) => n + 1, 0);

  const key = userId ? imageMemoryKey(userId, kind, id, variant) : null;
  const held = key ? memory.get(key) : undefined;
  const hit = held !== undefined;

  const request = tokenRequest(load);
  const requestAttempt = hit ? undefined : request?.attempt;
  const skipCache = request?.skipCache ?? false;
  useEffect(() => {
    if (requestAttempt === undefined) return;
    const arrived = (token: string | null) => setLoad((s) => tokenArrived(s, requestAttempt, token));
    if (!isSignedIn) {
      arrived(null);
      return;
    }
    const pending = forConvex ? getToken({ skipCache }) : getToken({ template: "convex", skipCache });
    void pending.then(
      (token) => arrived(token ?? null),
      () => arrived(null),
    );
    // getToken van Clerk is niet gememoïseerd (zie convexConnection).
  }, [requestAttempt, skipCache, isSignedIn, forConvex]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = imageLoadView(load);
  const loadToken = view.kind === "load" && !hit ? view.token : null;
  const loadAttempt = view.kind === "load" ? view.attempt : null;
  const url = site === null ? null : urlFor(site);
  useEffect(() => {
    if (loadToken === null || loadAttempt === null || key === null || url === null) return;
    const controller = new AbortController();
    const startedIn = generation;
    const attempt = loadAttempt;
    void (async () => {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${loadToken}` },
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`beeld ${res.status}`);
        const blob = await res.blob();
        if (controller.signal.aborted || startedIn !== generation) return;
        memory.put(key, { url: URL.createObjectURL(blob) });
        stored();
      } catch {
        if (controller.signal.aborted) return;
        setLoad((s) => imageFailed(s, attempt));
      }
    })();
    return () => controller.abort();
  }, [loadToken, loadAttempt, key, url]);

  let source: ImageSource | null | undefined;
  if (site === null || view.kind === "failed") source = null;
  else if (held) source = { uri: held.url };
  else source = undefined;
  const attempt = load.attempt;
  return {
    source,
    attempt,
    // Het beeld laadde niet (ook een `blob:` die niet te tonen was): eruit,
    // en de gewone herhaling met een vers token.
    onError: () => {
      if (key) memory.delete(key);
      // Kwam het beeld uit het geheugen (fase "wait"), dan haalt het
      // weghalen het opnieuw op; anders telt het als fout van deze poging.
      setLoad((s) => imageFailed(s, attempt));
      stored();
    },
    // "Opnieuw" op de fout-tegel.
    retry: () => setLoad((s) => retryByUser(s)),
  };
}

// Besluit 8 (WP17a): een profielfoto is openbaar; een gewone `<img>` toont hem
// zonder token en zonder CORS (WP35 besluit B2).
export function useProfileSource(userId: string, format: ImageFormat): ImageSource | null {
  const site = useSiteUrl();
  if (site === null) return null;
  return { uri: profileImageUrl(site, userId, format) };
}

// Uitloggen (W6): het geheugen leeg en alle `blob:`-URL's vrij. Op het web
// staat er niets op schijf.
export async function wipeImageCache(): Promise<boolean> {
  generation += 1;
  memory.clear();
  return true;
}
