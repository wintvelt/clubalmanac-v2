// WP42c invariant 8, A36 (punt 7 van 42a): sluit Android de app terwijl de
// kiezer open is, dan staat de keuze na terugkomen in het toevoegscherm, of
// ziet het lid dat hij opnieuw moet kiezen. Pure regels; het onthouden en de
// start staan in src/data/pendingPick.ts.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42c.
//
// - Vóór het openen van de kiezer onthoudt de app waarvoor (toevoegen, met het
//   gekozen album, of de profielfoto) en wanneer (`PickMark`).
// - Bij de start legt de app dat naast wat `getPendingResultAsync` geeft:
//   een keuze voor het toevoegscherm opent het toevoegscherm met die keuze en
//   het album van toen; geen resultaat of een fout, binnen PENDING_PICK_MAX_MS
//   na het openen voor het toevoegscherm: "kies opnieuw"; een keuze voor de
//   profielfoto of zonder bekend doel: de kopieën weg; annuleren: niets.

/** Zo lang na het openen van de kiezer zegt de app nog "kies opnieuw". */
export const PENDING_PICK_MAX_MS = 60 * 60 * 1000;

export const PICK_AGAIN_TEXT = "Je keuze kwam niet aan. Kies je foto's en filmpjes opnieuw.";

export type PickMark = { kind: "toevoegen"; albumId: string | null; at: number } | { kind: "profiel"; at: number };

/** Wat `ImagePicker.getPendingResultAsync` geeft: een resultaat, een fout met `code`, of niets. */
export type PendingResult<A> =
  | { canceled: false; assets: A[] }
  | { canceled: true; assets: null }
  | { code: string; message?: string }
  | null;

export type PendingPickAction<A> =
  | { kind: "niets" }
  | { kind: "toevoegen"; albumId: string | null; assets: A[] }
  | { kind: "opnieuw_kiezen"; albumId: string | null }
  | { kind: "weg"; uris: string[] };

export function pendingPickAction<A extends { uri: string }>(input: {
  mark: PickMark | null;
  result: PendingResult<A>;
  now: number;
}): PendingPickAction<A> {
  const { mark, result, now } = input;
  if (result !== null && "canceled" in result) {
    if (result.canceled) return { kind: "niets" };
    const assets = result.assets ?? [];
    if (assets.length === 0) return { kind: "niets" };
    // Alleen wat voor het toevoegscherm was, komt daar; een echte keuze telt altijd.
    if (mark?.kind === "toevoegen") return { kind: "toevoegen", albumId: mark.albumId, assets };
    return { kind: "weg", uris: assets.map((a) => a.uri) };
  }
  // Geen resultaat of een fout: alleen kort na het openen voor het toevoegscherm.
  if (mark?.kind === "toevoegen" && now - mark.at < PENDING_PICK_MAX_MS) {
    return { kind: "opnieuw_kiezen", albumId: mark.albumId };
  }
  return { kind: "niets" };
}

export function pickMarkToStore(mark: PickMark): string {
  return JSON.stringify(mark);
}

/** Onleesbaar of onbekend: `null` (geen doel). */
export function pickMarkFromStore(raw: string | null): PickMark | null {
  if (raw === null || raw === "") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const at = o.at;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (o.kind === "profiel") return { kind: "profiel", at };
  if (o.kind === "toevoegen") {
    const albumId = o.albumId;
    if (albumId === null || (typeof albumId === "string" && albumId !== "")) return { kind: "toevoegen", albumId, at };
  }
  return null;
}
