import type { GenericDatabaseReader, StorageWriter } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";

// WP41c — de foto bij een afrekening (spec §WP41c, besluiten 1–4, en
// §WP41c spec-criticus C2–C4).
//
// - `image` staat alleen bovenaan het verzoek: base64 met het standaard-
//   alfabet en `=`-opvulling (lengte een viervoud), zonder witruimte en zonder
//   `data:`-voorvoegsel. Ontsleuteld ten hoogste 1 MiB (A-keuze 16), en de
//   eerste drie bytes zijn `FF D8 FF`. Afmetingen en de rest van de JPEG
//   controleert Convex niet (A-keuze 17).
// - Een fout geeft een reden die met `image` begint, zonder een waarde uit de
//   body.
// - In storage staat de JPEG als `image/jpeg`; de afrekening heeft hoogstens
//   één object (`imageStorageId`). Een storage-id gaat nooit naar de client
//   (WP17a invariant 10); de app krijgt `hasImage` en een ondoorzichtige
//   `imageVersion`.

/** Besluit 2: met `image` ten hoogste 1,5 MiB in totaal. */
export const SETTLEMENT_MAX_BODY_WITH_IMAGE_BYTES = 1.5 * 1024 * 1024;
/** Besluit 2, A-keuze 16: ontsleuteld ten hoogste 1 MiB. */
export const SETTLEMENT_MAX_IMAGE_BYTES = 1024 * 1024;

// Eén tekenklasse plus opvulling aan het eind: geen herhaalde groepen, dus
// ook op 1,4 miljoen tekens geen backtracking.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type ImageParse = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Controleert en ontsleutelt `image` (C2). */
export function parseSettlementImage(value: unknown): ImageParse {
  if (typeof value !== "string") return { ok: false, error: "image: geen tekst" };
  if (value.length === 0) return { ok: false, error: "image: leeg" };
  if (value.length % 4 !== 0 || !BASE64.test(value)) {
    return { ok: false, error: "image: geen geldige base64" };
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (size > SETTLEMENT_MAX_IMAGE_BYTES) return { ok: false, error: "image: groter dan 1 MiB" };
  const bytes = decodeBase64(value, size);
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, error: "image: geen JPEG" };
  }
  return { ok: true, bytes };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const table = new Uint8Array(128);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

// Na `parseSettlementImage` staan er alleen tekens uit het alfabet in, met
// opvulling aan het eind. Zonder `atob` of `Buffer`: werkt zo in elke runtime.
function decodeBase64(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = LOOKUP[text.charCodeAt(i)]!;
    const b = LOOKUP[text.charCodeAt(i + 1)]!;
    const c = LOOKUP[text.charCodeAt(i + 2)]!;
    const d = LOOKUP[text.charCodeAt(i + 3)]!;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < size) out[o++] = (n >> 16) & 0xff;
    if (o < size) out[o++] = (n >> 8) & 0xff;
    if (o < size) out[o++] = n & 0xff;
  }
  return out;
}

/**
 * Haalt de foto van een afrekening uit storage (C3), als hij er nog is. Voor
 * vervangen, weghalen, G6 en de reset: overal dezelfde stap.
 */
export async function deleteSettlementImage(
  ctx: { db: GenericDatabaseReader<DataModel>; storage: StorageWriter },
  settlement: Pick<Doc<"settlements">, "imageStorageId">,
): Promise<void> {
  const id = settlement.imageStorageId;
  if (id && (await ctx.db.system.get(id))) await ctx.storage.delete(id);
}
