import { ConvexError } from "convex/values";

// WP38b: de pure beslissingen van de uploader voor originelen. Geen React,
// geen native modules; de wachtrij (originalQueue.ts), de runner
// (src/data/originals.ts) en het toevoegscherm gebruiken dit.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b.
//
// - 38b-1: gaat het origineel mee? Alleen met de uploader in deze build, in een
//   groep met een open project, tussen de grenzen van de backend, en met genoeg
//   vrije ruimte voor het origineel nog een keer (besluit 21: alle delen staan
//   tegelijk op schijf) plus een marge.
// - De delen: alle even groot behalve het laatste (R2), de grootte komt uit
//   het antwoord van `startOriginal`. Alleen delen met een link gaan; de rest
//   staat al in R2.
// - 38b-6: een mislukt deel. Na 403 of `NoSuchUpload` opnieuw aanmelden,
//   anders dezelfde link opnieuw, hooguit PART_ATTEMPTS keer, dan later.
// - "Alleen via wifi" (besluit 6, A-invariant 21): standaard aan, per toestel.

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Zelfde ondergrens als de backend (convex/lib/constants.ts, MIN_ORIGINAL_BYTES). */
export const ORIGINAL_MIN_BYTES = MiB;
/** Zelfde grens als de backend (convex/lib/constants.ts, MAX_ORIGINAL_BYTES). */
export const ORIGINAL_MAX_BYTES = 2 * GiB;
/** A-keuze: zoveel ruimte blijft vrij naast de delen op schijf. */
export const ORIGINAL_FREE_MARGIN_BYTES = GiB;
/** Mislukte pogingen met dezelfde link, daarna later opnieuw aanmelden. */
export const PART_ATTEMPTS = 5;

export type OpenProject = { groupId: string; projectId: string };
export type OriginalPlan =
  | { kind: "mee"; projectId: string }
  | { kind: "niet"; reason: "geen_uploader" | "geen_project" | "te_klein" | "te_groot" | "geen_ruimte" };

/** 38b-1, in deze volgorde: uploader, project, grootte, vrije ruimte. */
export function originalPlan(input: {
  uploaderAvailable: boolean;
  groupId: string;
  openProjects: readonly OpenProject[];
  bytes: number;
  freeBytes: number | null;
}): OriginalPlan {
  if (!input.uploaderAvailable) return { kind: "niet", reason: "geen_uploader" };
  const project = input.openProjects.find((p) => p.groupId === input.groupId);
  if (!project) return { kind: "niet", reason: "geen_project" };
  const { bytes } = input;
  if (!Number.isFinite(bytes) || bytes < ORIGINAL_MIN_BYTES) return { kind: "niet", reason: "te_klein" };
  if (bytes > ORIGINAL_MAX_BYTES) return { kind: "niet", reason: "te_groot" };
  const free = input.freeBytes;
  // Kan de module de vrije ruimte niet geven, dan houdt dat het origineel niet tegen.
  if (typeof free === "number" && Number.isFinite(free) && free < bytes + ORIGINAL_FREE_MARGIN_BYTES) {
    return { kind: "niet", reason: "geen_ruimte" };
  }
  return { kind: "mee", projectId: project.projectId };
}

export type PlannedPart = { partNumber: number; offset: number; size: number };

const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Aansluitende delen, alle `partSize` behalve het laatste. Ongeldig: geen delen. */
export function planParts(bytes: number, partSize: number): PlannedPart[] {
  if (!positiveInt(bytes) || !positiveInt(partSize)) return [];
  const parts: PlannedPart[] = [];
  for (let offset = 0, partNumber = 1; offset < bytes; offset += partSize, partNumber += 1) {
    parts.push({ partNumber, offset, size: Math.min(partSize, bytes - offset) });
  }
  return parts;
}

export type PartToSend = PlannedPart & { url: string };

/**
 * De links van `startOriginal` naast het plan, op volgorde van deelnummer.
 * Een link voor een deel dat niet bestaat, twee keer hetzelfde deel of een
 * ongeldige deelgrootte: `null`.
 */
export function partsToSend(
  bytes: number,
  partSize: number,
  links: readonly { partNumber: number; url: string }[],
): PartToSend[] | null {
  const plan = planParts(bytes, partSize);
  if (plan.length === 0) return null;
  const seen = new Set<number>();
  const out: PartToSend[] = [];
  for (const link of links) {
    const part = Number.isInteger(link.partNumber) ? plan[link.partNumber - 1] : undefined;
    if (!part || seen.has(link.partNumber) || typeof link.url !== "string" || link.url === "") return null;
    seen.add(link.partNumber);
    out.push({ ...part, url: link.url });
  }
  return out.sort((a, b) => a.partNumber - b.partNumber);
}

export type PartFailureAction = "opnieuw" | "opnieuw_aanmelden" | "later";

/** 38b-6: wat de app doet met een deel dat mislukte. */
export function partFailure(failure: { status: number | null; code: string | null; attempts: number }): PartFailureAction {
  if (failure.status === 403 || failure.code === "NoSuchUpload") return "opnieuw_aanmelden";
  return failure.attempts >= PART_ATTEMPTS ? "later" : "opnieuw";
}

export type Refusal = { kind: "geweigerd"; reason: string } | { kind: "fout" };

/** `ORIGINAL_REFUSED` met zijn reden (of `onbekend`); al het andere is een fout zonder reden. */
export function originalRefusal(error: unknown): Refusal {
  if (!(error instanceof ConvexError)) return { kind: "fout" };
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return { kind: "fout" };
  const { code, reason } = data as { code?: unknown; reason?: unknown };
  if (code !== "ORIGINAL_REFUSED") return { kind: "fout" };
  return { kind: "geweigerd", reason: typeof reason === "string" && reason !== "" ? reason : "onbekend" };
}

const WIFI_ON = "aan";
const WIFI_OFF = "uit";

/** Standaard aan: niets bewaard, leeg of onleesbaar telt als aan. */
export function wifiOnlyFromStore(stored: string | null): boolean {
  return stored !== WIFI_OFF;
}

export function wifiOnlyToStore(on: boolean): string {
  return on ? WIFI_ON : WIFI_OFF;
}

/**
 * Fix-cyclus 1, punt 6: bij de start, bij twijfel aan. Wat de app bewaarde
 * naast wat de uploader zegt (`null`: hij kon het niet zeggen); alleen als
 * beide uit zeggen, is het uit.
 */
export function wifiOnlyAtStart(stored: string | null, uploader: boolean | null): boolean {
  return wifiOnlyFromStore(stored) || uploader !== false;
}

export type NetworkView = { type: "wifi" | "mobiel" | "kabel" | "geen" | "anders" | "onbekend"; expensive: boolean };

/** Aan: alleen gewone wifi of een kabel; geen mobiel internet, geen hotspot (duur), geen of onbekend netwerk. */
export function waitsForWifi(wifiOnly: boolean, network: NetworkView): boolean {
  if (!wifiOnly) return false;
  if (network.expensive) return true;
  return network.type !== "wifi" && network.type !== "kabel";
}
