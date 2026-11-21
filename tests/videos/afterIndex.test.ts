import { describe, expect, it } from "vitest";
import { ascii, bigBox, box, bytes, ftyp, mdat, movie, movieHead, mvhd, nested, trak, u16, u32, zeros } from "./_boxes";
import { as, finish, leftovers, newT, putAsApp, seedWorld, start, TMP_PREFIX, useVideosEnv, type R, type T } from "./_videos";

// WP37 fixronde 1, punt 2 (audit en red-team): wat de route met het object in
// R2 doet, naast `inspectMp4` (mp4.test.ts).
//   A-invariant 31: na de index de koppen op het hoogste niveau aflopen met
//   kleine range-verzoeken; alleen mdat/free/skip, eindigend op de grootte,
//   hooguit 32 koppen. Een index boven het eerste stuk (512 KiB) opnieuw lezen.
//   A-invariant 28: een exception tijdens het bekijken is 422 `geen_mp4`, met
//   object en reservering weg.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 28, 31.

const env = useVideosEnv();
const r2 = () => env.r2;

const XYZ = box("\xa9xyz", u16(18), u16(0x15c7), ascii("+52.3676+004.9041/"));

async function upload(t: T, file: Uint8Array) {
  const w = await seedWorld(t);
  const s = (await start(as.alice(t), { uploadId: "v1", albumId: w.albums.georgie, bytes: file.byteLength })) as R;
  const key = await putAsApp(r2(), s.url, file);
  const res = await finish(as.alice(t), { uploadId: "v1" });
  return { w, key, res };
}

async function expectRefused(t: T, ownerId: Parameters<typeof leftovers>[2], res: Response, key: string, reason?: string) {
  expect(res.status).toBe(422);
  if (reason !== undefined) expect(((await res.json()) as R).reason).toBe(reason);
  expect(r2().objects.has(key)).toBe(false);
  const left = await leftovers(t, r2(), ownerId);
  expect(left.photos).toBe(0);
  expect(left.reservations).toBe(0);
  expect(left.storage).toBe(0);
  for (const k of r2().keys()) expect(k.startsWith(TMP_PREFIX), k).toBe(true);
}

describe("na de index alleen beelddata (A-invariant 31)", () => {
  it("sanity: ftyp, moov, mdat, free mag", async () => {
    const t = newT();
    const { res } = await upload(t, bytes(movieHead(), mdat(zeros(256)), box("free", zeros(8))));
    expect(res.status).toBe(200);
  });

  it.each([
    ["udta met ©xyz na de beelddata", () => bytes(movieHead(), mdat(), box("udta", XYZ))],
    ["een tweede moov na de beelddata", () => bytes(movieHead(), mdat(), box("moov", mvhd(600, 1200), trak("vide", "avc1")))],
    ["moof (gefragmenteerd)", () => bytes(movieHead(), box("moof", box("mfhd", zeros(8))), mdat())],
    ["een onbekend blok", () => bytes(movieHead(), mdat(), box("abcd", zeros(16)))],
    ["uuid met ©xyz", () => bytes(movieHead(), mdat(), box("uuid", zeros(16), XYZ))],
    ["losse bytes aan het eind", () => bytes(movieHead(), mdat(), [1, 2, 3, 4, 5])],
    ["een mdat die langer zegt te zijn dan het bestand", () => bytes(movieHead(), u32(100_000), ascii("mdat"), zeros(64))],
  ])("%s: 422, object en reservering weg", async (_naam, make) => {
    const t = newT();
    const { w, key, res } = await upload(t, make());
    await expectRefused(t, w.users.alice, res, key);
  });

  it("meer dan 32 koppen na de index: 422, en de backend leest niet elke kop", async () => {
    const t = newT();
    const tail = Array.from({ length: 100 }, () => box("free", zeros(8)));
    const { w, key, res } = await upload(t, bytes(movieHead(), mdat(), ...tail));
    await expectRefused(t, w.users.alice, res, key);
    const gets = r2().calls.filter((c) => c.method === "GET" && c.key === key);
    expect(gets.length, "meer verzoeken dan nodig om te weigeren").toBeLessThanOrEqual(40);
  });

  it("de backend leest kleine stukken: bij 4 MB beelddata minder dan 1 MiB, nooit het hele bestand", async () => {
    const t = newT();
    const file = bytes(movieHead(), bigBox("mdat", 4 * 1024 * 1024), box("free", zeros(8)));
    const { key, res } = await upload(t, file);
    expect(res.status).toBe(200);
    const gets = r2().calls.filter((c) => c.method === "GET" && c.key === key);
    expect(gets.length).toBeGreaterThan(0);
    for (const c of gets) expect(c.range).toMatch(/^bytes=\d+-\d+$/);
    expect(r2().bytesRead(key)).toBeLessThan(1024 * 1024);
  });
});

describe("een index groter dan het eerste stuk (512 KiB)", () => {
  it("een index van ~700 KiB wordt helemaal gelezen: zonder locatie 200", async () => {
    const t = newT();
    const file = movie({ moovExtra: [Array.from(bigBox("udta", 700 * 1024))] });
    const { res } = await upload(t, file);
    expect(res.status).toBe(200);
  });

  it("met ©xyz aan het eind van die index (voorbij 512 KiB): 422 locatie", async () => {
    const t = newT();
    const file = movie({ moovExtra: [Array.from(bigBox("udta", 700 * 1024, XYZ))] });
    const { w, key, res } = await upload(t, file);
    await expectRefused(t, w.users.alice, res, key, "locatie");
  });
});

describe("een exception tijdens het bekijken (A-invariant 28)", () => {
  it("60.000 geneste blokken in het object: 422 geen_mp4, object en reservering weg", async () => {
    const t = newT();
    const bomb = nested("mdia", 60_000);
    const inner = trak("vide", "avc1").slice(8);
    const trakBytes = bytes(u32(8 + inner.length + bomb.length), ascii("trak"), inner, bomb);
    const moovBody = bytes(mvhd(600, 1200), trakBytes);
    const file = bytes(ftyp("mp42"), u32(8 + moovBody.length), ascii("moov"), moovBody, mdat());
    const { w, key, res } = await upload(t, file);
    await expectRefused(t, w.users.alice, res, key, "geen_mp4");
  });
});
