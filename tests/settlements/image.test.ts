import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { SCHOON, SCHOON_B } from "../_helpers/jpeg";
import {
  as,
  b64,
  configure,
  del,
  jpegOfSize,
  MAX_BODY_BYTES,
  MAX_BODY_WITH_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  newT,
  post,
  postOk,
  request,
  rows,
  seedWorld,
  settlementsApi,
  snapshot,
  storageIds,
  storedBytes,
  useFinanceEnv,
  withImage,
  type R,
  type T,
} from "./_settlements";

// WP41c — de foto bij een afrekening (spec §WP41c, besluiten 1–4, en
// §WP41c spec-criticus C2–C4).
//   - `image` is optioneel: base64 (standaard, met opvulling, zonder `data:`)
//     van een JPEG; ontsleuteld ten hoogste 1 MiB, begint met FF D8 FF. Anders
//     400 met een reden die met `image` begint en geen waarde uit de body noemt.
//   - Grootte: zonder `image` blijft 128 KiB de grens (ook voor wat naast de
//     foto staat); met `image` ten hoogste 1,5 MiB in totaal. Anders 413.
//   - Volgorde: geheim, grootte, vorm. Bij elke 4xx: geen rij en geen nieuw
//     object in storage.
//   - Opslag: precies één object per afrekening met foto. Vervangen (met of
//     zonder foto), weghalen en de groep verwijderen ruimen de oude foto op.
//     Mislukt het schrijven, dan gaat de nieuwe foto weer weg.
//   - Lezen: `hasImage` en `imageVersion`, nooit een storage-id of base64.
//
// De beelden zijn echte JPEG's zonder metadata (tests/fixtures/wp17d).

useFinanceEnv();

const lustrum = (): R => request("lustrum");
const weekend = (): R => request("weekend");

async function settlementIdOf(t: T, key: string): Promise<string> {
  const row = (await rows(t)).find((r) => r.key === key);
  if (!row) throw new Error(`geen afrekening met sleutel ${key}`);
  return row._id as string;
}

/** Een geweigerd verzoek laat de tabel en de storage precies zoals ze waren. */
async function expectNothingWritten(t: T, body: R | string, status: number): Promise<string> {
  const beforeRows = await snapshot(t);
  const beforeStorage = (await storageIds(t)).sort();
  const res = await post(t, body);
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(await snapshot(t)).toEqual(beforeRows);
  expect((await storageIds(t)).sort()).toEqual(beforeStorage);
  return text;
}

/** Eerst een geldige afrekening mét foto, dan een fout met dezelfde sleutel. */
async function withStoredPhoto(): Promise<T> {
  const t = newT();
  await seedWorld(t);
  await postOk(t, withImage(lustrum(), SCHOON));
  expect(await storageIds(t)).toHaveLength(1);
  return t;
}

// --- het veld image: vorm ---------------------------------------------------------

describe("C2: image is geldige base64 van een JPEG", () => {
  it("zonder image: aangenomen, geen object in storage (zoals vóór WP41c)", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, lustrum());
    expect(await storageIds(t)).toEqual([]);
  });

  it("met een JPEG: 200 met `{ participants }`, en precies één object in storage met die bytes", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await post(t, withImage(lustrum(), SCHOON));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ participants: 8 });
    const ids = await storageIds(t);
    expect(ids).toHaveLength(1);
    expect(Array.from(await storedBytes(t, ids[0]!))).toEqual(Array.from(SCHOON));
  });

  const INVALID: Array<[string, (b: R) => void]> = [
    ["null", (b) => (b.image = null)],
    ["een lege tekst", (b) => (b.image = "")],
    ["een getal", (b) => (b.image = 17)],
    ["een object", (b) => (b.image = { data: b64(SCHOON) })],
    ["met data:-voorvoegsel", (b) => (b.image = `data:image/jpeg;base64,${b64(SCHOON)}`)],
    ["met een regeleinde erin", (b) => (b.image = `${b64(SCHOON).slice(0, 8)}\n${b64(SCHOON).slice(8)}`)],
    ["met een spatie erin", (b) => (b.image = `${b64(SCHOON).slice(0, 8)} ${b64(SCHOON).slice(8)}`)],
    ["een teken buiten het alfabet", (b) => (b.image = `${b64(SCHOON).slice(0, -4)}*AAA`)],
    // SCHOON begint met FF D8 FF, in base64 "/9j/": in het URL-alfabet "_9j_".
    ["het URL-alfabet (- en _)", (b) => (b.image = b64(SCHOON).replace(/\//g, "_").replace(/\+/g, "-"))],
    ["zonder opvulling (lengte geen viervoud)", (b) => (b.image = b64(jpegOfSize(10)).replace(/=+$/, ""))],
    ["een PNG", (b) => (b.image = b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])))],
    ["alleen FF D8 (geen derde FF)", (b) => (b.image = b64(new Uint8Array([0xff, 0xd8, 0x00, 0xe0])))],
    ["tekst in base64", (b) => (b.image = b64(new TextEncoder().encode("<svg onload=alert(1)>")))],
  ];
  for (const [label, mutate] of INVALID) {
    it(`${label}: 400 met een reden over image; niets geschreven, geen object in storage`, async () => {
      const t = await withStoredPhoto();
      const body = lustrum();
      body.name = "Mag niet binnenkomen";
      mutate(body);
      const text = await expectNothingWritten(t, body, 400);
      const error = (JSON.parse(text) as { error: string }).error;
      expect(error).toMatch(/^image\b/);
    });
  }

  it("de reden noemt geen waarde uit de body", async () => {
    const t = newT();
    await seedWorld(t);
    const marker = "QUJDREVGR0hJSktMTU5PUA";
    const res = await post(t, { ...lustrum(), image: `${marker}*==` });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain(marker);
  });

  it("image op een andere plek dan bovenaan is een onbekend veld (400)", async () => {
    const t = newT();
    await seedWorld(t);
    const body = lustrum();
    (body.rows as R[])[0]!.image = b64(SCHOON);
    await expectNothingWritten(t, body, 400);
  });

  it("de grens van 200 tekens en de teken-controles gelden niet voor image", async () => {
    const t = newT();
    await seedWorld(t);
    expect(b64(SCHOON).length).toBeGreaterThan(200);
    await postOk(t, withImage(lustrum(), SCHOON));
  });
});

// --- grootte ---------------------------------------------------------------------

describe("C2: grootte (besluit 2, A-keuze 16)", () => {
  it("een foto van precies 1 MiB naast het lustrum: 200 (de body is dan ruim boven 128 KiB)", async () => {
    const t = newT();
    await seedWorld(t);
    const body = withImage(lustrum(), jpegOfSize(MAX_IMAGE_BYTES));
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeGreaterThan(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(MAX_BODY_WITH_IMAGE_BYTES);
    await postOk(t, body);
    expect(await storageIds(t)).toHaveLength(1);
  });

  it("een foto van 1 MiB + 1 byte: 400 (image), niet 413; niets geschreven", async () => {
    const t = await withStoredPhoto();
    const body = withImage({ ...lustrum(), name: "Te grote foto" }, jpegOfSize(MAX_IMAGE_BYTES + 1));
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(MAX_BODY_WITH_IMAGE_BYTES);
    const text = await expectNothingWritten(t, body, 400);
    expect((JSON.parse(text) as { error: string }).error).toMatch(/^image\b/);
  });

  it("een body boven 1,5 MiB: 413, ook als de foto zelf al te groot is (grootte vóór vorm)", async () => {
    const t = await withStoredPhoto();
    const body = withImage(lustrum(), jpegOfSize(1_200_000));
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeGreaterThan(MAX_BODY_WITH_IMAGE_BYTES);
    await expectNothingWritten(t, body, 413);
  });

  it("met foto: wat naast de foto staat, mag niet boven 128 KiB komen (413)", async () => {
    const t = await withStoredPhoto();
    const raw = JSON.stringify(withImage({ ...lustrum(), name: "Opgevuld" }, SCHOON));
    const padded = raw + " ".repeat(MAX_BODY_BYTES);
    await expectNothingWritten(t, padded, 413);
  });

  it("zonder foto: 128 KiB blijft de grens, ook al is de body kleiner dan 1,5 MiB (413)", async () => {
    const t = await withStoredPhoto();
    const raw = JSON.stringify({ ...lustrum(), name: "Opgevuld" }).padEnd(MAX_BODY_BYTES + 1, " ");
    await expectNothingWritten(t, raw, 413);
  });

  it("een kapotte body tussen 128 KiB en 1,5 MiB: 413 (F4 blijft)", async () => {
    const t = await withStoredPhoto();
    const raw = `{ "key": "17", "image": "${b64(jpegOfSize(200_000))}" `;
    await expectNothingWritten(t, raw, 413);
  });

  it("een image die geen tekst is, telt mee als 'naast de foto' (413 boven 128 KiB)", async () => {
    const t = await withStoredPhoto();
    const body = { ...lustrum(), image: Array.from({ length: 40_000 }, () => 255) };
    await expectNothingWritten(t, body, 413);
  });
});

// --- volgorde: geheim, grootte, vorm -------------------------------------------------

describe("C2: volgorde (A4 met foto)", () => {
  it("fout geheim met een geldige foto: 403, geen object in storage", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await post(t, withImage(lustrum(), SCHOON), { secret: "fout".repeat(16) });
    expect(res.status).toBe(403);
    expect(await rows(t)).toEqual([]);
    expect(await storageIds(t)).toEqual([]);
  });

  it("fout geheim met een body boven 1,5 MiB: 403, niet 413", async () => {
    const t = newT();
    await seedWorld(t);
    const res = await post(t, withImage(lustrum(), jpegOfSize(1_200_000)), { secret: null });
    expect(res.status).toBe(403);
    expect(await storageIds(t)).toEqual([]);
  });

  it("een vormfout elders met een geldige foto: 400, de foto komt niet in storage", async () => {
    const t = await withStoredPhoto();
    const body = withImage({ ...lustrum(), name: "Kapotte totalen" }, SCHOON_B);
    (body.totals as R).costs = ((body.totals as R).costs as number) + 1;
    await expectNothingWritten(t, body, 400);
  });
});

// --- opslag en opruimen ----------------------------------------------------------

describe("C3: vervangen ruimt de oude foto op", () => {
  it("met een nieuwe foto: één object, met de nieuwe bytes; het oude is weg", async () => {
    const t = await withStoredPhoto();
    const [old] = await storageIds(t);
    await postOk(t, withImage(lustrum(), SCHOON_B));
    const ids = await storageIds(t);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(old);
    expect(Array.from(await storedBytes(t, ids[0]!))).toEqual(Array.from(SCHOON_B));
  });

  it("zonder foto: geen object meer, en hasImage wordt false", async () => {
    const t = await withStoredPhoto();
    await postOk(t, lustrum());
    expect(await storageIds(t)).toEqual([]);
    const id = await settlementIdOf(t, "17");
    const got = await as.alice(t).query(settlementsApi.get, { settlementId: id });
    expect(got.hasImage).toBe(false);
    expect(got.imageVersion).toBeNull();
  });

  it("dezelfde foto opnieuw: nog steeds precies één object", async () => {
    const t = await withStoredPhoto();
    await postOk(t, withImage(lustrum(), SCHOON));
    await postOk(t, withImage(lustrum(), SCHOON));
    expect(await storageIds(t)).toHaveLength(1);
  });

  it("vervangen houdt het _id (A-invariant 4), ook met een foto erbij", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, lustrum());
    const before = await settlementIdOf(t, "17");
    await postOk(t, withImage(lustrum(), SCHOON));
    expect(await settlementIdOf(t, "17")).toBe(before);
  });

  it("de foto van een andere afrekening blijft staan", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    await postOk(t, withImage(weekend(), SCHOON_B));
    expect(await storageIds(t)).toHaveLength(2);
    await postOk(t, lustrum());
    const ids = await storageIds(t);
    expect(ids).toHaveLength(1);
    expect(Array.from(await storedBytes(t, ids[0]!))).toEqual(Array.from(SCHOON_B));
  });
});

describe("C3: mislukt schrijven ruimt de nieuwe foto op", () => {
  it("een 41e sleutel met foto (groep vol, A-invariant 7): 400, geen nieuw object; de bestaande foto's blijven", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    for (let i = 0; i < 39; i++) await postOk(t, { ...weekend(), key: `w${i}` });
    expect(await rows(t)).toHaveLength(40);
    const before = (await storageIds(t)).sort();
    const res = await post(t, withImage({ ...weekend(), key: "vol" }, SCHOON_B));
    expect(res.status).toBe(400);
    expect(await rows(t)).toHaveLength(40);
    expect((await storageIds(t)).sort()).toEqual(before);
  });
});

describe("C3: weghalen ruimt de foto op", () => {
  it("DELETE /settlements?key=…: de afrekening en haar foto weg", async () => {
    const t = await withStoredPhoto();
    const res = await del(t, "17");
    expect(res.status).toBe(200);
    expect(await rows(t)).toEqual([]);
    expect(await storageIds(t)).toEqual([]);
  });

  it("een onbekende sleutel weghalen raakt geen foto", async () => {
    const t = await withStoredPhoto();
    await del(t, "999");
    expect(await storageIds(t)).toHaveLength(1);
  });

  it("dezelfde sleutel in een andere groep houdt haar foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    configure(w.groups.other);
    await postOk(t, withImage(lustrum(), SCHOON_B));
    configure(w.groups.club);
    await del(t, "17");
    const ids = await storageIds(t);
    expect(ids).toHaveLength(1);
    expect(Array.from(await storedBytes(t, ids[0]!))).toEqual(Array.from(SCHOON_B));
  });
});

describe("C3 en G6: de groep weg → haar foto's weg", () => {
  async function world(t: T) {
    const w = await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    await postOk(t, withImage(weekend(), SCHOON));
    configure(w.groups.other);
    await postOk(t, withImage({ ...weekend(), name: "Weekend Ander" }, SCHOON_B));
    configure(w.groups.club);
    expect(await storageIds(t)).toHaveLength(3);
    return w;
  }

  it("groups.remove: de foto's van die groep weg, die van de andere groep blijft", async () => {
    const t = newT();
    const w = await world(t);
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    const ids = await storageIds(t);
    expect(ids).toHaveLength(1);
    expect(Array.from(await storedBytes(t, ids[0]!))).toEqual(Array.from(SCHOON_B));
  });

  it("M2-e: het laatste lid verwijdert zijn account; de foto van die groep weg, de rest blijft", async () => {
    const t = newT();
    await world(t);
    await deleteAccount(t, as.dave(t));
    expect(await storageIds(t)).toHaveLength(2);
  });
});

// --- lezen -------------------------------------------------------------------------

describe("C4: hasImage en imageVersion", () => {
  it("listByGroup en get: hasImage true en een versie bij een foto, false en null zonder", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    await postOk(t, weekend());
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    const withPhoto = list.find((x) => x.name === "Lustrum Nepal")!;
    const without = list.find((x) => x.name === "Clubweekend Ardennen")!;
    expect(withPhoto.hasImage).toBe(true);
    expect(typeof withPhoto.imageVersion).toBe("string");
    expect(withPhoto.imageVersion).not.toBe("");
    expect(without.hasImage).toBe(false);
    expect(without.imageVersion).toBeNull();

    const got = await as.alice(t).query(settlementsApi.get, { settlementId: withPhoto._id });
    expect(got.hasImage).toBe(true);
    expect(got.imageVersion).toBe(withPhoto.imageVersion);
  });

  it("een nieuwe foto geeft een nieuwe versie (zo krijgt de app een nieuwe URL)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    const [first] = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    await postOk(t, withImage(lustrum(), SCHOON_B));
    const [second] = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    expect(second!._id).toBe(first!._id);
    expect(second!.imageVersion).not.toBe(first!.imageVersion);
  });

  it("geen storage-id, geen storage-URL en geen base64 in een antwoord (WP17a invariant 10)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const body = withImage(lustrum(), SCHOON);
    await postOk(t, body);
    const [storageId] = await storageIds(t);
    const list = await as.alice(t).query(settlementsApi.listByGroup, { groupId: w.groups.club });
    const got = await as.alice(t).query(settlementsApi.get, { settlementId: list[0]!._id });
    for (const json of [JSON.stringify(list), JSON.stringify(got)]) {
      expect(json).not.toContain(storageId!);
      expect(json).not.toContain((body.image as string).slice(0, 40));
      expect(json).not.toMatch(/https?:\/\//);
      expect(json).not.toContain('"image"');
    }
  });

  it("geen lid: nog steeds NOT_MEMBER, ook met een foto (niets verandert aan de toegang)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, withImage(lustrum(), SCHOON));
    await expect(as.carol(t).query(settlementsApi.listByGroup, { groupId: w.groups.club })).rejects.toBeDefined();
  });
});
