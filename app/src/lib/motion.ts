// WP33: subtiele animaties. Alle maten en verlopen op één plek (F4), als pure
// functies. De functies voor de kop en het informatieblok lopen elk frame op
// de UI-thread mee met het scrollen (F3), vandaar de "worklet"-regel.
// "Beperk beweging" (invariant 11, F2) zet alles op de eindstand: het gedrag
// van vóór dit WP.

// De kop van Groep en Album in rust: de gemeten hoogte inclusief de
// statusbalk (groeit mee met grote tekst, A5) en de statusbalk zelf.
export type HeaderLayout = { height: number; topInset: number };

export type HeaderMotion = {
  // y van de bovenrand van de cover op het scherm.
  coverTop: number;
  // Hoe hoog de cover op het scherm is.
  coverHeight: number;
  // Hoe ver de foto binnen dat vlak is ingezoomd (1 = past precies).
  coverZoom: number;
};

// Omhoog scrollen: de cover gaat met deze fractie van de snelheid van de
// inhoud mee (parallax, invariant 1).
const PARALLAX = 0.5;
// In rust staat de foto licht ingezoomd; uitgezoomd tot 1× als de kop uit
// beeld is (rustiger dan v1, dat van 2× kwam).
const COVER_ZOOM = 1.15;
// Letter-tegel en pil krimpen tot deze schaal terwijl ze vervagen.
const FADE_SCALE = 0.85;
// Ze zijn weg ruim voordat hun bovenkant de statusbalk raakt.
const FADE_MARGIN = 0.8;

// Indrukken (besluit 5): knoppen en tegels krimpen duidelijk; een tegel wordt
// iets donkerder en de cover erin zoomt in. In plus terug samen 150 ms (B6).
const PRESS = { scale: 0.94, coverZoom: 1.15, shade: 0.12, inDuration: 70, outDuration: 80 } as const;
// Verschijnen: alleen doorzichtigheid (D1).
const APPEAR = { fromOpacity: 0, duration: 200 } as const;

function clamp01(x: number): number {
  "worklet";
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Waar de cover staat, hoe hoog en hoe ver ingezoomd, bij scrollpositie
// `offset` (0 = bovenaan, positief = omhoog gescrold, negatief = bovenaan
// omlaag getrokken). Zonder cover (verloop met letter) dezelfde beweging
// zonder zoom. De inhoud schuift over de kop: de cover eindigt precies waar
// de inhoud begint (A1).
export function headerMotion(
  offset: number,
  layout: HeaderLayout,
  opts: { cover: boolean; reduceMotion: boolean },
): HeaderMotion {
  "worklet";
  const { height } = layout;
  // Trekken: de cover blijft aan de bovenkant vast en rekt tot de inhoud
  // (invariant 2, A4). Ook met "Beperk beweging": hij volgt de vinger
  // (besluit Wouter 2026-11-18, 1).
  if (offset < 0) {
    const zoom = opts.cover && !opts.reduceMotion ? COVER_ZOOM : 1;
    return { coverTop: 0, coverHeight: height - offset, coverZoom: zoom };
  }
  if (opts.reduceMotion) return { coverTop: -offset, coverHeight: height, coverZoom: 1 };
  const coverTop = -PARALLAX * offset;
  const coverHeight = Math.max(0, height - (1 - PARALLAX) * offset);
  const progress = height > 0 ? clamp01(offset / height) : 1;
  const coverZoom = opts.cover ? COVER_ZOOM - (COVER_ZOOM - 1) * progress : 1;
  return { coverTop, coverHeight, coverZoom };
}

// Een element in de kop (de letter-tegel, de terugknop-pil) dat in rust op
// y = `elementTop` staat: vervaagt en krimpt licht bij omhoog scrollen, en is
// weg voordat zijn bovenkant onder de statusbalk komt (A2). Bij trekken en
// met "Beperk beweging": gewoon zichtbaar (A4, F2).
export function headerFade(
  offset: number,
  elementTop: number,
  layout: HeaderLayout,
  opts: { reduceMotion: boolean },
): { opacity: number; scale: number } {
  "worklet";
  if (opts.reduceMotion || offset <= 0) return { opacity: 1, scale: 1 };
  // Het element gaat met de cover mee; zijn bovenkant raakt de statusbalk
  // bij offset = afstand / PARALLAX.
  const distance = elementTop - layout.topInset;
  const gone = (Math.max(distance, 0) / PARALLAX) * FADE_MARGIN;
  if (gone <= 0) return { opacity: 0, scale: FADE_SCALE };
  const progress = clamp01(offset / gone);
  return { opacity: 1 - progress, scale: 1 - (1 - FADE_SCALE) * progress };
}

// Doorzichtigheid van het informatieblok in het foto-detail tijdens het
// swipen (invariant 7). `position`: de horizontale scrollpositie in pagina's;
// `shownIndex`: de foto waarvan het blok de gegevens toont. Halverwege twee
// foto's is het blok onzichtbaar: daar wisselen de gegevens (C1).
export function infoOpacity(position: number, shownIndex: number, count: number, reduceMotion: boolean): number {
  "worklet";
  if (reduceMotion || count <= 1) return 1;
  // Voorbij de eerste of laatste foto trekken: het blok blijft staan (C3).
  const p = position < 0 ? 0 : position > count - 1 ? count - 1 : position;
  return clamp01(1 - 2 * Math.abs(p - shownIndex));
}

// Indrukken: de schaal en de duur, voor een knop of de cover in een tegel.
export type PressFeedback = {
  // De hele knop of tegel krimpt hiertoe.
  scale: number;
  // De cover in een tegel zoomt hiertoe in, binnen zijn vak.
  coverZoom: number;
  // Dekking van de donkere laag over een tegel.
  shade: number;
  // Het dimmen van een knop van vóór WP33: alleen met "Beperk beweging".
  dim: boolean;
  inDuration: number;
  outDuration: number;
};

export function pressFeedback(kind: "button" | "tile", reduceMotion: boolean): PressFeedback {
  "worklet";
  const tile = kind === "tile";
  // Een tegel wordt met en zonder "Beperk beweging" even donker (F2, F4).
  const shade = tile ? PRESS.shade : 0;
  if (reduceMotion) return { scale: 1, coverZoom: 1, shade, dim: !tile, inDuration: 0, outDuration: 0 };
  return {
    scale: PRESS.scale,
    coverZoom: tile ? PRESS.coverZoom : 1,
    shade,
    dim: false,
    inDuration: PRESS.inDuration,
    outDuration: PRESS.outDuration,
  };
}

// Loslaten, `heldMs` na het indrukken (B6): was de eindstand nog niet bereikt,
// dan eerst daarheen (`delay`), dan terugveren (`duration`). De actie zelf
// wacht hier niet op (B5).
export function pressRelease(
  heldMs: number,
  kind: "button" | "tile",
  reduceMotion: boolean,
): { delay: number; duration: number } {
  "worklet";
  const { inDuration, outDuration } = pressFeedback(kind, reduceMotion);
  const held = heldMs > 0 ? heldMs : 0;
  return { delay: held < inDuration ? inDuration - held : 0, duration: outDuration };
}

// Verschijnen van een melding, tegel of rij: vanaf deze doorzichtigheid in
// deze duur naar volledig zichtbaar.
export function appearFeedback(reduceMotion: boolean): { fromOpacity: number; duration: number } {
  if (reduceMotion) return { fromOpacity: 1, duration: 0 };
  return { fromOpacity: APPEAR.fromOpacity, duration: APPEAR.duration };
}

// Welke items nieuw binnenkomen (D4). `previous`: de ids die het scherm al
// toonde (undefined = de lijst laadde nog); `next`: de ids nu (undefined =
// laadt). Een item dat er al was, ook gewijzigd of op een andere plek, telt
// niet.
export function newlyArrived(previous: readonly string[] | undefined, next: readonly string[] | undefined): string[] {
  if (next === undefined) return [];
  if (previous === undefined) return [...next];
  const seen = new Set(previous);
  return next.filter((id) => !seen.has(id));
}
