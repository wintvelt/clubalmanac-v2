import { ConvexError } from "convex/values";

// WP21 — de pure logica van de clubfilms in de app.
// Spec: docs/work-packages/WP21-videos.md §Testcontract.
//
// - Pariteit: kopjes "Trailers" en "Blockbusters", in de volgorde van de
//   backend; de tab Films alleen in een groep met films.
// - Invariant 7: zonder cover een nette tegel (`hasCover` false: geen link).
// - Invariant 6 en A-invariant 15: geen film op schijf; een cover wel in de
//   cache, onder een vaste sleutel per film (de ondertekende link wisselt per
//   verzoek, dus zonder vaste sleutel wordt elke cover elke keer gehaald).
// - Invariant 5 en A-invariant 14: een fout geeft een NL-melding met opnieuw
//   proberen; opnieuw proberen haalt een verse link en gaat verder waar de
//   kijker was.
//
// Geen import van expo-video hier: dit bestand draait ook in de tests.

/** Een film zoals `api.films.list` hem geeft. */
export type FilmListItem = {
  _id: string;
  groupId: string;
  kind: "trailer" | "film";
  title: string;
  year: number;
  hasCover: boolean;
};

export type FilmSection<F extends FilmListItem = FilmListItem> = {
  kind: FilmListItem["kind"];
  title: string;
  films: F[];
};

const SECTIONS: ReadonlyArray<{ kind: FilmListItem["kind"]; title: string }> = [
  { kind: "trailer", title: "Trailers" },
  { kind: "film", title: "Blockbusters" },
];

/** Trailers, dan Blockbusters; binnen een soort de volgorde van de backend. Een lege soort valt weg. */
export function filmSections<F extends FilmListItem>(films: readonly F[]): FilmSection<F>[] {
  return SECTIONS.map(({ kind, title }) => ({ kind, title, films: films.filter((f) => f.kind === kind) })).filter(
    (s) => s.films.length > 0,
  );
}

/** Of de groep films heeft. Zolang de lijst laadt: nee (geen tab die weer verdwijnt). */
export function groupHasFilms(films: readonly FilmListItem[] | undefined, groupId: string): boolean {
  return films?.some((f) => f.groupId === groupId) ?? false;
}

/** De bron van een cover voor expo-image: de ondertekende link, met een vaste cache-sleutel per film. */
export function coverSource(filmId: string, signedUrl: string): { uri: string; cacheKey: string } {
  return { uri: signedUrl, cacheKey: `film-cover-${filmId}` };
}

/** De bron voor expo-video: streamen vanaf de ondertekende link, nooit uit een schijfcache. */
export function filmVideoSource(
  signedUrl: string,
  title: string,
): { uri: string; useCaching: false; metadata: { title: string } } {
  return { uri: signedUrl, useCaching: false, metadata: { title } };
}

// --- afspelen ----------------------------------------------------------------

export type Playback = {
  phase: "loading" | "ready" | "error";
  /** Elke poging haalt een verse link. */
  attempt: number;
  /** Waar de kijker was (seconden): opnieuw proberen gaat hier verder. */
  position: number;
};

export type PlaybackEvent =
  | { type: "linkReady" }
  | { type: "progress"; seconds: number }
  | { type: "failed" }
  | { type: "retry" };

export const initialPlayback: Playback = { phase: "loading", attempt: 0, position: 0 };

export function playbackReducer(s: Playback, e: PlaybackEvent): Playback {
  switch (e.type) {
    case "linkReady":
      return s.phase === "loading" ? { ...s, phase: "ready" } : s;
    case "progress":
      // Alleen tijdens het spelen: een speler die opnieuw laadt of faalt,
      // meldt 0 en mag de plek van de kijker niet wissen.
      return s.phase === "ready" && Number.isFinite(e.seconds) ? { ...s, position: e.seconds } : s;
    case "failed":
      return { ...s, phase: "error" };
    case "retry":
      return s.phase === "error" ? { ...s, phase: "loading", attempt: s.attempt + 1 } : s;
  }
}

// --- meldingen ---------------------------------------------------------------

export type FilmErrorKind = "link" | "playback" | "cover";

const MESSAGES: Record<FilmErrorKind, string> = {
  link: "De film laden lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
  playback: "Het afspelen is gestopt. Probeer het opnieuw: de film gaat verder waar je was.",
  cover: "Niet alle covers zijn geladen. Controleer je verbinding en probeer het opnieuw.",
};

export function filmErrorMessage(kind: FilmErrorKind): { text: string; retryLabel: string } {
  return { text: MESSAGES[kind], retryLabel: "Opnieuw proberen" };
}

/** De weigering van de backend (A-invariant 11): geen toegang of geen film meer. */
export function isFilmRefusal(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === "FILM_NOT_FOUND";
}
