// WP18: pure helpers voor `POST /upload` (convex/http.ts). Geen Convex-runtime.

/** HEIF-familie met HEVC-inhoud, zoals WP25 er formaten van maakt. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * A-invariant 14: het type uit de bytes, niet uit `Content-Type`. Alleen
 * JPEG, PNG en HEIC; al het andere (video, tekst, PDF, GIF, leeg) is null.
 */
export function uploadImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/heic" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a)
    return "image/png";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12))) return "image/heic";
  return null;
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * A-keuze 2: `X-Taken-At` in EXIF-vorm "JJJJ:MM:DD UU:MM:SS", gelezen zoals
 * exif-parser een EXIF-datum leest: de klokwaarde als UTC, in ms. Geen echte
 * datum (verkeerde vorm, de nul-datum, 30 februari, uur 25): undefined.
 */
export function parseTakenAt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const m = EXIF_DATE.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return undefined;
  }
  return ms;
}

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

/**
 * Vraag 2 (besluit: bewaren, als headers): `X-Latitude` en `X-Longitude` in
 * decimale graden. Alleen samen en binnen bereik; anders geen locatie.
 */
export function parseLocation(
  lat: string | null,
  lon: string | null,
): { latitude: number; longitude: number } | undefined {
  if (lat === null || lon === null) return undefined;
  const a = lat.trim();
  const o = lon.trim();
  if (!DECIMAL.test(a) || !DECIMAL.test(o)) return undefined;
  const latitude = Number(a);
  const longitude = Number(o);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}
