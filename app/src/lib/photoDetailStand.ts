// WP46: de standen van het foto-detail op de telefoon, als pure logica.
//
// - Rechtop: normaal (kop, foto, infoblok, tabbalk, statusbalk) of
//   schermvullend (alleen de foto op zwart). Een tik wisselt.
// - Liggend: altijd schermvullend; een tik toont of verbergt de kop met terug
//   en Acties (besluit 5, A4: tot de volgende tik).
// - Draaien naar liggend begint zonder kop; terug naar rechtop geeft de stand
//   van rechtop van vóór het draaien (A-invariant 5).
// - De iPad en het web doen niet mee (besluiten 1 en 6); een Android-tablet
//   telt als telefoon (besluit A5).
// - Met een schermlezer blijft rechtop normaal en staat liggend de kop er
//   altijd (besluit A7).
// - Een tik op een filmpje verandert de stand niet (besluit 7).
// Spec: docs/work-packages/WP46-foto-detail-schermvullend.md.

export type Orientation = "portrait" | "landscape";

export type StandEvent = { type: "tap" } | { type: "rotate"; orientation: Orientation };

/** Een waarde: verandert alleen via `nextStand`. */
export type Stand = {
  readonly orientation: Orientation;
  /** Rechtop schermvullend; blijft bewaard zolang het toestel liggend is. */
  readonly portraitFull: boolean;
  /** Liggend met de kop. */
  readonly landscapeHeader: boolean;
};

export type StandView = {
  header: boolean;
  info: boolean;
  tabBar: boolean;
  statusBar: boolean;
  black: boolean;
};

export function fullscreenAllowed({ os, isPad }: { os: string; isPad: boolean }): boolean {
  if (os === "ios") return !isPad;
  return os === "android";
}

export function orientationOf({ width, height }: { width: number; height: number }): Orientation {
  return width > height ? "landscape" : "portrait";
}

export function initialStand(orientation: Orientation): Stand {
  return { orientation, portraitFull: false, landscapeHeader: false };
}

export function nextStand(stand: Stand, event: StandEvent): Stand {
  if (event.type === "tap") {
    return stand.orientation === "portrait"
      ? { ...stand, portraitFull: !stand.portraitFull }
      : { ...stand, landscapeHeader: !stand.landscapeHeader };
  }
  if (event.orientation === stand.orientation) return stand;
  return event.orientation === "landscape"
    ? { ...stand, orientation: "landscape", landscapeHeader: false }
    : { ...stand, orientation: "portrait" };
}

const NORMAL: StandView = { header: true, info: true, tabBar: true, statusBar: true, black: false };

export function standView(
  stand: Stand,
  { fullscreenAllowed: allowed, screenReader }: { fullscreenAllowed: boolean; screenReader: boolean },
): StandView {
  if (!allowed) return { ...NORMAL };
  if (stand.orientation === "portrait") {
    return stand.portraitFull && !screenReader
      ? { header: false, info: false, tabBar: false, statusBar: false, black: true }
      : { ...NORMAL };
  }
  return { header: screenReader || stand.landscapeHeader, info: false, tabBar: false, statusBar: false, black: true };
}

/** Binnen deze tijd telt een tweede tik als dubbeltik (zoomen, iOS). */
export const DOUBLE_TAP_MS = 280;

export type TapTarget = "zoomable" | "photo" | "video";
export type TapIntent = "zoom" | "wait" | "stand" | "none";

export function tapIntent({
  lastTapAt,
  now,
  target,
}: {
  /** Een vorige tik die nog wacht, of `null`. */
  lastTapAt: number | null;
  now: number;
  target: TapTarget;
}): TapIntent {
  if (target === "video") return "none";
  if (target === "photo") return "stand";
  return lastTapAt !== null && now - lastTapAt < DOUBLE_TAP_MS ? "zoom" : "wait";
}
