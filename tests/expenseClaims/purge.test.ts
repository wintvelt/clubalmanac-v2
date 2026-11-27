import { describe, expect, it } from "vitest";
import {
  as,
  claimRows,
  claimsApi,
  claimsOk,
  configureClaims,
  decideOk,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  purge,
  PURGE_MAX_BYTES,
  PURGE_MAX_ITEMS,
  read,
  reject,
  revisionOf,
  seedWorld,
  snapshot,
  TOO_LARGE_BODY,
  useClaimsEnv,
  type R,
  type T,
} from "./_claims";

// WP45 §A8 — POST /claims/purge (apart geheim, access.test.ts).
//   Besluit 8: weg gaan alleen processed, adjusted, rejected en withdrawn,
//   met precies die revision; nooit submitted of draft.
//   A-keuze 11: deleted en skipped zijn lijsten van ids, in de volgorde van
//   het verzoek; een lege lijst mag; een dubbel id is 400.
//   A-keuze 9: ten hoogste 200 per keer, body ten hoogste 32 KiB.
//   Draft-invariant 10: een declaratie van een andere groep wordt skipped.

useClaimsEnv();

async function expectInvalid(t: T, payload: unknown): Promise<void> {
  const before = await snapshot(t);
  const { status, body, text } = await read(await purge(t, payload));
  expect(status, text).toBe(400);
  expect(body).toMatchObject({ v: 1, error: "invalid" });
  expect(typeof body.reason).toBe("string");
  expect(await snapshot(t)).toEqual(before);
}

describe("§A8: wat weg mag", () => {
  it("processed, adjusted, rejected, withdrawn (ook zonder besluit) met de juiste revision: weg", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const p = await newSubmitted(as.alice(t), w.groups.club, { title: "P" });
    await processClaim(t, p);
    const a = await newSubmitted(as.alice(t), w.groups.club, { title: "A" });
    await decideOk(t, { id: a, status: "adjusted", processedCents: 10, note: null, revision: 2 });
    const r = await newSubmitted(as.bob(t), w.groups.club, { title: "R" });
    await reject(t, r);
    const x = await newSubmitted(as.bob(t), w.groups.club, { title: "X" });
    await as.bob(t).mutation(claimsApi.withdraw, { claimId: x });
    const keep = await newSubmitted(as.erik(t), w.groups.club, { title: "Blijft" });

    const items = [];
    for (const id of [p, a, r, x]) items.push({ id, revision: await revisionOf(t, id) });
    const { status, body } = await read(await purge(t, { claims: items }));
    expect(status).toBe(200);
    expect(body).toEqual({ v: 1, ok: true, deleted: [p, a, r, x], skipped: [] });
    expect((await claimRows(t)).map((row) => row._id)).toEqual([keep]);
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([keep]);
  });

  it("submitted, draft, een andere revision, onbekend, al weg, geen id, een andere groep: skipped en ze blijven", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const submitted = await newSubmitted(as.alice(t), w.groups.club, { title: "Verzonden" });
    const draft = await newDraft(as.alice(t), w.groups.club, { title: "Concept" });
    const stale = await newSubmitted(as.bob(t), w.groups.club, { title: "Verouderd" });
    await processClaim(t, stale);
    const gone = await newSubmitted(as.bob(t), w.groups.club, { title: "Weg" });
    const goneRev = await processClaim(t, gone);
    expect((await read(await purge(t, { claims: [{ id: gone, revision: goneRev }] }))).body.deleted).toEqual([gone]);
    configureClaims(w.groups.other);
    const elsewhere = await newSubmitted(as.dave(t), w.groups.other, { title: "Elders" });
    const elsewhereRev = await processClaim(t, elsewhere);
    configureClaims(w.groups.club);

    const before = await snapshot(t);
    const items = [
      { id: submitted, revision: 2 },
      { id: draft, revision: 1 },
      { id: stale, revision: 2 },
      { id: "onbekend", revision: 1 },
      { id: gone, revision: goneRev },
      { id: w.users.alice, revision: 1 },
      { id: elsewhere, revision: elsewhereRev },
    ];
    const { status, body } = await read(await purge(t, { claims: items }));
    expect(status).toBe(200);
    expect(body).toEqual({ v: 1, ok: true, deleted: [], skipped: items.map((i) => i.id) });
    expect(await snapshot(t)).toEqual(before);
  });

  it("gemengd: deleted en skipped elk in de volgorde van het verzoek", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const ids: string[] = [];
    for (const title of ["1", "2", "3", "4"]) ids.push(await newSubmitted(as.alice(t), w.groups.club, { title }));
    await processClaim(t, ids[0]!);
    await processClaim(t, ids[2]!);
    const items = [ids[3]!, ids[2]!, ids[1]!, ids[0]!].map((id) => ({ id, revision: 3 }));
    const { body } = await read(await purge(t, { claims: items }));
    expect(body.deleted).toEqual([ids[2], ids[0]]);
    expect(body.skipped).toEqual([ids[3], ids[1]]);
  });

  it("een lege lijst: 200 met twee lege lijsten", async () => {
    const t = newT();
    await seedWorld(t);
    const { status, body } = await read(await purge(t, { claims: [] }));
    expect(status).toBe(200);
    expect(body).toEqual({ v: 1, ok: true, deleted: [], skipped: [] });
  });

  it("200 elementen mag", async () => {
    const t = newT();
    await seedWorld(t);
    const items = Array.from({ length: PURGE_MAX_ITEMS }, (_, i) => ({ id: `onbekend${i}`, revision: 1 }));
    const { status, body } = await read(await purge(t, { claims: items }));
    expect(status).toBe(200);
    expect((body.skipped as unknown[]).length).toBe(PURGE_MAX_ITEMS);
  });
});

describe("§A8: de vorm (400, niets weg)", () => {
  async function oneProcessed(t: T): Promise<{ id: string; revision: number }> {
    const w = await seedWorld(t);
    const id = await newSubmitted(as.alice(t), w.groups.club);
    return { id, revision: await processClaim(t, id) };
  }

  const CASES: Array<[string, (ok: R) => unknown]> = [
    ["geen JSON", () => "{ kapot"],
    ["geen object", (ok) => [ok]],
    ["claims ontbreekt", () => ({})],
    ["claims is geen lijst", (ok) => ({ claims: ok })],
    ["een onbekend veld bovenaan", (ok) => ({ claims: [ok], groupId: "x" })],
    ["een onbekend veld in een element", (ok) => ({ claims: [{ ...ok, status: "processed" }] })],
    ["id ontbreekt", (ok) => ({ claims: [{ revision: ok.revision }] })],
    ["revision ontbreekt", (ok) => ({ claims: [{ id: ok.id }] })],
    ["id is geen tekst", (ok) => ({ claims: [{ id: 5, revision: ok.revision }] })],
    ["revision 0", (ok) => ({ claims: [{ id: ok.id, revision: 0 }] })],
    ["revision een breuk", (ok) => ({ claims: [{ id: ok.id, revision: 2.5 }] })],
    ["een dubbel id (A-keuze 11)", (ok) => ({ claims: [ok, ok] })],
    [
      "201 elementen",
      (ok) => ({
        claims: [ok, ...Array.from({ length: PURGE_MAX_ITEMS }, (_, i) => ({ id: `onbekend${i}`, revision: 1 }))],
      }),
    ],
  ];

  for (const [label, make] of CASES) {
    it(label, async () => {
      const t = newT();
      const ok = await oneProcessed(t);
      await expectInvalid(t, make(ok));
      expect(await claimRows(t)).toHaveLength(1);
    });
  }

  it("body groter dan 32 KiB: 413 { v: 1, error: too_large }, niets weg", async () => {
    const t = newT();
    const ok = await oneProcessed(t);
    const big = JSON.stringify({ claims: [ok] }).padEnd(PURGE_MAX_BYTES + 1, " ");
    const { status, body } = await read(await purge(t, big));
    expect(status).toBe(413);
    expect(body).toEqual(TOO_LARGE_BODY);
    expect(await claimRows(t)).toHaveLength(1);
  });

  it("te groot én kapot: 413", async () => {
    const t = newT();
    await oneProcessed(t);
    const { status } = await read(await purge(t, `{ kapot ${"x".repeat(PURGE_MAX_BYTES)}`));
    expect(status).toBe(413);
  });
});
