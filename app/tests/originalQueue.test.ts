import { describe, expect, it } from "vitest";
import {
  LINK_MARGIN_MS,
  RESUME_ROUNDS,
  WAIT_MS,
  addOriginal,
  applyEvent,
  atLaunch,
  forgetUser,
  nextCall,
  nextWake,
  ownOriginalStand,
  queueFromStore,
  queueToStore,
  type Effect,
  type NativeJobView,
  type QueueEntry,
  type QueueEvent,
  type StartResult,
} from "../src/lib/originalQueue";
import type { NetworkView } from "../src/lib/originalUpload";
import { ORIGINAL_PART_LINK_SECONDS } from "../../convex/lib/constants";

// WP38b — de wachtrij van originelen op dit toestel, als pure functies.
//   - Per filmpje één origineel in de wachtrij (sleutel: de upload-id van het
//     filmpje voor het album, WP37), van één user.
//   - Aanmelden pas als het filmpje in het album staat (A-invariant 18), op
//     elk netwerk. Alleen de delen wachten op wifi (iOS, niet de wachtrij).
//   - Aanroepen na elkaar, in een vaste volgorde (afronden, hervatten, nieuw);
//     bij `te_vaak` wacht alles van die user, bij `bezig` alleen een nieuwe
//     aanmelding (38b-7).
//   - `finishOriginal` pas als iOS alle delen heeft verstuurd (38b-8).
//   - Opnieuw aanmelden alleen na 403 of `NoSuchUpload`, na `missing`, of als
//     de links bijna verlopen zijn; niet bij een herstart als de bewaarde
//     links nog gelden (38b-5, 38b-6).
//   - Binnen, teruggetrokken of geweigerd: het bestand weg en nooit opnieuw
//     aanmelden; wachten of een fout: het bestand blijft (38b-9, 38b-10).
//   - Bij de start: wat iOS nog heeft, loopt door; wezen weg (38b-5).
//   - De stand per eigen origineel voor de projectpagina (38c toont hem).
//   Fix-cyclus 1:
//   - Elke ronde links heeft een generatie; events en taken van een oudere
//     generatie tellen niet (punt 5).
//   - De geldigheid van de links telt vanaf het antwoord, niet met de klok van
//     het toestel tegen `expiresAt` van de server (punt 7).
//   - Na `fout` oplopend wachten: 1 minuut, tot een uur (punt 8).
//   - De wachtrij op schijf heeft een versie; velden komen er alleen bij (punt 9).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b.

const MiB = 1024 * 1024;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const U = "user-1";
const BYTES = 291 * MiB; // 10 delen van 32 MiB

function add(queue: QueueEntry[], key: string, now = T0, userId = U): QueueEntry[] {
  return addOriginal(queue, { key, userId, projectId: "p1", fileName: `${key}.mov`, bytes: BYTES }, now);
}

// Fix-cyclus 1, punt 5: elke ronde links heeft een generatie. `aan_ios` geeft
// hem mee aan de uploader; de events van de uploader (`delen_klaar`,
// `deel_mislukt`) en zijn taken (`NativeJobView`) geven hem terug. In de
// tests staat HUIDIG voor "de generatie van de laatste `aan_ios` van dat
// origineel"; run() vult hem in vlak voor het event, zoals de uploader doet.
const HUIDIG = -987_654_321;
const gens = new Map<string, number>();
const gen = (originalId: string): number => {
  const g = gens.get(originalId);
  if (g === undefined) throw new Error(`geen aan_ios met een generatie gezien voor ${originalId} (fix-cyclus 1, punt 5)`);
  return g;
};

function withGeneration(e: QueueEvent): QueueEvent {
  if ((e.kind === "delen_klaar" || e.kind === "deel_mislukt") && e.generation === HUIDIG) {
    return { ...e, generation: gen(e.originalId) };
  }
  return e;
}

function run(queue: QueueEntry[], events: QueueEvent[], now = T0): { queue: QueueEntry[]; effects: Effect[] } {
  const effects: Effect[] = [];
  let q = queue;
  for (const e of events) {
    const r = applyEvent(q, withGeneration(e), now);
    q = r.queue;
    effects.push(...r.effects);
    for (const fx of r.effects) {
      if (fx.kind === "aan_ios" && typeof fx.generation === "number") gens.set(fx.originalId, fx.generation);
    }
  }
  return { queue: q, effects };
}

function upload(originalId: string, parts: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], expiresAt = T0 + 7 * DAY): StartResult {
  return {
    kind: "upload",
    originalId,
    partSize: 32 * MiB,
    parts: parts.map((n) => ({ partNumber: n, url: `https://r2.invalid/${originalId}?partNumber=${n}` })),
    expiresAt,
  };
}

const refused = (reason: string): StartResult => ({ kind: "geweigerd", reason });

/** Een origineel dat in het album staat en is aangemeld: de delen zijn bij iOS. */
function sending(key = "k1", originalId = "o1", now = T0, queue: QueueEntry[] = [], userId = U): QueueEntry[] {
  return run(add(queue, key, now, userId), [
    { kind: "album_klaar", key, photoId: `photo-${key}` },
    { kind: "aangemeld", key, result: upload(originalId) },
  ], now).queue;
}

const ctx = (now = T0, userId: string | null = U) => ({ now, userId });
const find = (queue: QueueEntry[], key: string) => queue.find((e) => e.key === key);

describe("toevoegen en het filmpje voor het album (A-invariant 18)", () => {
  it("een nieuw origineel wacht op het album: nog geen aanroep", () => {
    const q = add([], "k1");
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ key: "k1", userId: U, step: "album", photoId: null, originalId: null, bytes: BYTES });
    expect(nextCall(q, ctx())).toBeNull();
  });

  it("per filmpje hooguit één origineel: dezelfde sleutel nog eens verandert niets", () => {
    const q = add(add([], "k1"), "k1", T0 + 1000);
    expect(q).toHaveLength(1);
    expect(q[0]!.addedAt).toBe(T0);
  });

  it("filmpje in het album: aanmelden, met het filmpje en precies de bewaarde grootte", () => {
    const { queue, effects } = run(add([], "k1"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "start", key: "k1", photoId: "photo-1", bytes: BYTES });
  });

  it("filmpje kwam niet in het album: het origineel weg, het bestand van het toestel", () => {
    const { queue, effects } = run(add([], "k1"), [{ kind: "album_mislukt", key: "k1" }]);
    expect(queue).toEqual([]);
    expect(effects).toEqual([{ kind: "bestand_weg", fileName: "k1.mov" }]);
  });
});

describe("aangemeld (startOriginal)", () => {
  const ready = () => run(add([], "k1"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]).queue;

  it("links: alle delen met een link meteen aan iOS (besluit 21), met hun plek in het bestand", () => {
    const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result: upload("o1", [1, 10]) }]);
    expect(effects).toEqual([
      {
        kind: "aan_ios",
        originalId: "o1",
        fileName: "k1.mov",
        generation: expect.any(Number),
        parts: [
          { partNumber: 1, offset: 0, size: 32 * MiB, url: "https://r2.invalid/o1?partNumber=1" },
          { partNumber: 10, offset: 9 * 32 * MiB, size: 3 * MiB, url: "https://r2.invalid/o1?partNumber=10" },
        ],
      },
    ]);
    expect(find(queue, "k1")).toMatchObject({ step: "versturen", originalId: "o1" });
  });

  it("terwijl iOS verstuurt, roept de wachtrij de backend niet aan", () => {
    const q = sending();
    expect(nextCall(q, ctx())).toBeNull();
    expect(nextCall(q, ctx(T0 + 5 * DAY))).toBeNull();
  });

  it("links zonder delen (alles staat al in R2): meteen afronden, niets aan iOS", () => {
    const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result: upload("o1", []) }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });

  it("al binnen: het bestand weg, uit de wachtrij", () => {
    const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result: { kind: "done", originalId: "o1" } }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
    expect(effects.some((e) => e.kind === "aan_ios")).toBe(false);
  });

  it.each(["niet_toegestaan", "te_groot", "te_klein"])(
    "geweigerd met %s: het bestand weg en nooit meer aanmelden",
    (reason) => {
      const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result: refused(reason) }]);
      expect(queue).toEqual([]);
      expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
      expect(nextCall(queue, ctx(T0 + 30 * DAY))).toBeNull();
    },
  );

  it("niet_toegestaan bij hervatten (teruggetrokken, verwijderd door de oprichter): iOS vergeet het en het bestand gaat weg", () => {
    const q = run(sending(), [
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 4, status: 404, code: "NoSuchUpload", attempts: 1 },
    ]).queue;
    expect(nextCall(q, ctx())).toMatchObject({ kind: "start", key: "k1" });
    const { queue, effects } = run(q, [{ kind: "aangemeld", key: "k1", result: refused("niet_toegestaan") }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
  });

  it.each([
    ["fout", { kind: "fout" } as StartResult, WAIT_MS.fout],
    ["uitgelogd", refused("uitgelogd"), WAIT_MS.uitgelogd],
    ["vol", refused("vol"), WAIT_MS.vol],
    ["een onbekende reden", refused("nieuw_in_2027"), WAIT_MS.onbekend],
  ])("%s: wachten en dan opnieuw; het bestand blijft", (_label, result, wait) => {
    const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result }]);
    expect(effects).toEqual([]);
    expect(queue).toHaveLength(1);
    expect(nextCall(queue, ctx(T0 + wait - 1))).toBeNull();
    expect(nextWake(queue, ctx())).toBe(T0 + wait);
    expect(nextCall(queue, ctx(T0 + wait))).toEqual({ kind: "start", key: "k1", photoId: "photo-1", bytes: BYTES });
  });

  it("ongeldige links (een deel dat niet bestaat): niets aan iOS, wachten zoals bij een fout", () => {
    const bad: StartResult = { ...upload("o1", [1]), parts: [{ partNumber: 99, url: "https://r2.invalid/x" }] } as StartResult;
    const { queue, effects } = run(ready(), [{ kind: "aangemeld", key: "k1", result: bad }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toBeNull();
    expect(nextCall(queue, ctx(T0 + WAIT_MS.fout))).toMatchObject({ kind: "start", key: "k1" });
  });
});

describe("wachttijden (A-keuze)", () => {
  it("vast gelegd", () => {
    expect(WAIT_MS).toEqual({
      fout: 60 * 1000,
      uitgelogd: 5 * 60 * 1000,
      te_vaak: HOUR,
      bezig: HOUR,
      later: HOUR,
      onbekend: HOUR,
      vol: DAY,
      vast: DAY,
    });
    expect(RESUME_ROUNDS).toBe(3);
    expect(LINK_MARGIN_MS).toBe(DAY);
  });
});

describe("te_vaak en bezig (38b-7)", () => {
  it("te_vaak: alles van die user wacht een uur, ook afronden; een andere user niet", () => {
    let q = run(add([], "k1"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]).queue;
    q = run(add(q, "k2", T0 + 1), [
      { kind: "album_klaar", key: "k2", photoId: "photo-2" },
      { kind: "aangemeld", key: "k2", result: upload("o2", []) },
    ]).queue;
    q = run(add(q, "x1", T0, "user-2"), [{ kind: "album_klaar", key: "x1", photoId: "photo-x" }]).queue;

    const { queue, effects } = run(q, [{ kind: "aangemeld", key: "k1", result: refused("te_vaak") }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx(T0 + HOUR - 1))).toBeNull();
    expect(nextCall(queue, ctx(T0, "user-2"))).toMatchObject({ kind: "start", key: "x1" });
    expect(nextCall(queue, ctx(T0 + HOUR))).toEqual({ kind: "finish", key: "k2", originalId: "o2" });
  });

  it("te_vaak bij afronden: daarna weer afronden, niet opnieuw aanmelden", () => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue } = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "geweigerd", reason: "te_vaak" } }]);
    expect(nextCall(queue, ctx(T0 + HOUR - 1))).toBeNull();
    expect(nextCall(queue, ctx(T0 + HOUR))).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });

  it("te_vaak maakt een langere wachttijd niet korter", () => {
    let q = run(add([], "k1"), [
      { kind: "album_klaar", key: "k1", photoId: "photo-1" },
      { kind: "aangemeld", key: "k1", result: refused("vol") },
    ]).queue;
    q = run(add(q, "k2"), [
      { kind: "album_klaar", key: "k2", photoId: "photo-2" },
      { kind: "aangemeld", key: "k2", result: refused("te_vaak") },
    ]).queue;
    expect(nextCall(q, ctx(T0 + HOUR))).toMatchObject({ key: "k2" });
    expect(nextCall(run(q, [{ kind: "aangemeld", key: "k2", result: { kind: "done", originalId: "o2" } }], T0 + HOUR).queue, ctx(T0 + HOUR))).toBeNull();
  });

  it("bezig: alleen die nieuwe aanmelding wacht; hervatten en afronden gaan door", () => {
    let q = sending("k1", "o1");
    q = run(q, [{ kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 2, status: 403, code: "AccessDenied", attempts: 1 }]).queue;
    q = run(add(q, "k2", T0 + 1), [
      { kind: "album_klaar", key: "k2", photoId: "photo-2" },
      { kind: "aangemeld", key: "k2", result: refused("bezig") },
    ]).queue;
    expect(nextCall(q, ctx())).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
  });

  it("bezig: zodra een ander origineel van die user klaar is, meteen weer; anders na een uur", () => {
    let q = run(sending("k1", "o1"), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    q = run(add(q, "k2", T0 + 1), [
      { kind: "album_klaar", key: "k2", photoId: "photo-2" },
      { kind: "aangemeld", key: "k2", result: refused("bezig") },
    ]).queue;
    expect(nextCall(q, ctx())).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
    expect(nextWake(q, ctx())).toBe(T0 + WAIT_MS.bezig);

    const after = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "done" } }], T0 + 10).queue;
    expect(nextCall(after, ctx(T0 + 10))).toEqual({ kind: "start", key: "k2", photoId: "photo-2", bytes: BYTES });
  });
});

describe("afronden (38b-8)", () => {
  it("pas als iOS alle delen heeft verstuurd", () => {
    const q = sending();
    expect(nextCall(q, ctx())).toBeNull();
    const { queue, effects } = run(q, [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });

  it("binnen: iOS vergeet het, het bestand weg, uit de wachtrij", () => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue, effects } = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "done" } }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
  });

  it("missing: opnieuw aanmelden (nieuwe links voor wat ontbreekt), het bestand blijft", () => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue, effects } = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "missing", parts: [3] } }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
  });

  it.each(["niet_toegestaan", "geen_video"])("geweigerd met %s: weg en nooit meer aanmelden", (reason) => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue, effects } = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "geweigerd", reason } }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
  });

  it("een fout bij afronden: later weer afronden, het bestand blijft", () => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue, effects } = run(q, [{ kind: "afgerond", key: "k1", result: { kind: "fout" } }]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx(T0 + WAIT_MS.fout - 1))).toBeNull();
    expect(nextCall(queue, ctx(T0 + WAIT_MS.fout))).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });
});

describe("een mislukt deel (38b-6)", () => {
  it.each([
    [403, "SignatureDoesNotMatch"],
    [403, "AccessDenied"],
    [404, "NoSuchUpload"],
  ])("%i %s: opnieuw aanmelden, zonder iets weg te gooien", (status, code) => {
    const { queue, effects } = run(sending(), [
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 4, status, code, attempts: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
  });

  it("een serverfout of geen antwoord: hetzelfde deel opnieuw bij iOS, met dezelfde link", () => {
    const { queue, effects } = run(sending(), [
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 4, status: 503, code: null, attempts: 1 },
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 5, status: null, code: null, attempts: 2 },
    ]);
    expect(effects).toEqual([
      { kind: "ios_opnieuw", originalId: "o1", partNumber: 4 },
      { kind: "ios_opnieuw", originalId: "o1", partNumber: 5 },
    ]);
    expect(nextCall(queue, ctx())).toBeNull();
  });

  it("te vaak mislukt met dezelfde link: een uur wachten, dan opnieuw aanmelden", () => {
    const { queue, effects } = run(sending(), [
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 4, status: 503, code: null, attempts: 5 },
    ]);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx(T0 + WAIT_MS.later - 1))).toBeNull();
    expect(nextCall(queue, ctx(T0 + WAIT_MS.later))).toMatchObject({ kind: "start", key: "k1" });
  });

  it("veel delen tegelijk 403 (alle links verlopen): één keer aanmelden", () => {
    const events: QueueEvent[] = [1, 2, 3, 4, 5].map((n) => ({
      kind: "deel_mislukt",
      originalId: "o1",
      generation: HUIDIG,
      partNumber: n,
      status: 403,
      code: "AccessDenied",
      attempts: 1,
    }));
    const one = run(sending(), events.slice(0, 1)).queue;
    const five = run(sending(), events).queue;
    expect(five).toEqual(one);
  });

  it("een mislukking van een origineel dat niet (meer) verstuurt, telt niet", () => {
    const q = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    const { queue, effects } = run(q, [
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 2, status: 403, code: "AccessDenied", attempts: 1 },
      { kind: "deel_mislukt", originalId: "onbekend", generation: 1, partNumber: 1, status: 403, code: null, attempts: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(queue).toEqual(q);
  });
});

describe("hervatten zonder eindeloze rondes", () => {
  const fail403: QueueEvent = { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 1, status: 403, code: "AccessDenied", attempts: 1 };

  it("drie aanmeldingen (RESUME_ROUNDS) zonder dat R2 iets meer heeft: een dag wachten", () => {
    let q = sending(); // aanmelding 1: delen 1–10
    q = run(q, [fail403, { kind: "aangemeld", key: "k1", result: upload("o1") }]).queue; // 2
    q = run(q, [fail403, { kind: "aangemeld", key: "k1", result: upload("o1") }]).queue; // 3
    q = run(q, [fail403]).queue;
    expect(nextCall(q, ctx())).toBeNull();
    expect(nextCall(q, ctx(T0 + WAIT_MS.vast - 1))).toBeNull();
    expect(nextCall(q, ctx(T0 + WAIT_MS.vast))).toMatchObject({ kind: "start", key: "k1" });
  });

  it("zolang R2 bij elke aanmelding minder delen mist, geen pauze", () => {
    let q = sending(); // 10 delen
    q = run(q, [fail403, { kind: "aangemeld", key: "k1", result: upload("o1", [5, 6, 7, 8, 9, 10]) }]).queue;
    q = run(q, [fail403, { kind: "aangemeld", key: "k1", result: upload("o1", [8, 9, 10]) }]).queue;
    q = run(q, [fail403, { kind: "aangemeld", key: "k1", result: upload("o1", [10]) }]).queue;
    q = run(q, [fail403]).queue;
    expect(nextCall(q, ctx())).toMatchObject({ kind: "start", key: "k1" });
  });

  it("ook bij steeds missing na afronden: na drie rondes een dag wachten", () => {
    const missing: QueueEvent = { kind: "afgerond", key: "k1", result: { kind: "missing", parts: [1, 2] } };
    let q = run(sending("k1", "o1"), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }, missing]).queue;
    q = run(q, [{ kind: "aangemeld", key: "k1", result: upload("o1") }, { kind: "delen_klaar", originalId: "o1", generation: HUIDIG }, missing]).queue;
    q = run(q, [{ kind: "aangemeld", key: "k1", result: upload("o1") }, { kind: "delen_klaar", originalId: "o1", generation: HUIDIG }, missing]).queue;
    expect(nextCall(q, ctx())).toBeNull();
    expect(nextCall(q, ctx(T0 + WAIT_MS.vast))).toMatchObject({ kind: "start", key: "k1" });
  });
});

describe("links die bijna verlopen (38b-5)", () => {
  it("minder dan een dag geldig: eerst nieuwe links, ook als de delen op wifi wachten", () => {
    const q = sending(); // links tot T0 + 7 dagen
    expect(nextCall(q, ctx(T0 + 6 * DAY))).toBeNull();
    expect(nextCall(q, ctx(T0 + 6 * DAY + 1))).toEqual({ kind: "start", key: "k1", photoId: "photo-k1", bytes: BYTES });
    expect(nextWake(q, ctx())).toBe(T0 + 6 * DAY + 1);
  });

  it("de nieuwe links gaan weer aan iOS (ze vervangen de oude)", () => {
    const later = T0 + 6 * DAY + 1;
    const { queue, effects } = run(sending(), [
      { kind: "aangemeld", key: "k1", result: upload("o1", [7, 8], later + 7 * DAY) },
    ], later);
    expect(effects).toEqual([
      expect.objectContaining({ kind: "aan_ios", originalId: "o1", parts: [expect.objectContaining({ partNumber: 7 }), expect.objectContaining({ partNumber: 8 })] }),
    ]);
    expect(nextCall(queue, ctx(later))).toBeNull();
  });
});

describe("terugtrekken en een kapot bestand (38b-9, 38b-11)", () => {
  it("teruggetrokken: iOS vergeet het, het bestand weg, nooit meer aanmelden", () => {
    const { queue, effects } = run(sending(), [{ kind: "teruggetrokken", originalId: "o1" }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
  });

  it("een origineel dat niet in de wachtrij staat (al binnen, ander toestel) terugtrekken: niets", () => {
    const q = sending();
    expect(run(q, [{ kind: "teruggetrokken", originalId: "o9" }])).toEqual({ queue: q, effects: [] });
  });

  it("het bewaarde bestand is weg of heeft een andere grootte: uit de wachtrij, niet opnieuw aanmelden", () => {
    const { queue, effects } = run(sending(), [{ kind: "bestand_kapot", key: "k1" }]);
    expect(queue).toEqual([]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
  });
});

describe("nextCall: na elkaar, in een vaste volgorde (38b-7)", () => {
  it("afronden, dan hervatten, dan nieuw; binnen elke soort de oudste eerst", () => {
    let q = run(add([], "nieuw", T0), [{ kind: "album_klaar", key: "nieuw", photoId: "photo-n" }]).queue;
    q = run(add(q, "hervat", T0 + 1), [
      { kind: "album_klaar", key: "hervat", photoId: "photo-h" },
      { kind: "aangemeld", key: "hervat", result: upload("oh") },
      { kind: "deel_mislukt", originalId: "oh", generation: HUIDIG, partNumber: 1, status: 404, code: "NoSuchUpload", attempts: 1 },
    ]).queue;
    q = run(add(q, "af2", T0 + 3), [
      { kind: "album_klaar", key: "af2", photoId: "photo-a2" },
      { kind: "aangemeld", key: "af2", result: upload("oa2", []) },
    ]).queue;
    q = run(add(q, "af1", T0 + 2), [
      { kind: "album_klaar", key: "af1", photoId: "photo-a1" },
      { kind: "aangemeld", key: "af1", result: upload("oa1", []) },
    ]).queue;

    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const call = nextCall(q, ctx());
      if (!call) break;
      order.push(call.key);
      const done: QueueEvent =
        call.kind === "finish"
          ? { kind: "afgerond", key: call.key, result: { kind: "done" } }
          : { kind: "aangemeld", key: call.key, result: { kind: "done", originalId: `o-${call.key}` } };
      q = run(q, [done]).queue;
    }
    expect(order).toEqual(["af1", "af2", "hervat", "nieuw"]);
  });

  it("alleen voor de user die nu is ingelogd; uitgelogd: niets", () => {
    const q = run(add([], "k1", T0, "user-2"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]).queue;
    expect(nextCall(q, ctx(T0, U))).toBeNull();
    expect(nextCall(q, ctx(T0, null))).toBeNull();
    expect(nextCall(q, ctx(T0, "user-2"))).toMatchObject({ kind: "start", key: "k1" });
  });

  it("nextWake: niets te wachten, dan null", () => {
    expect(nextWake([], ctx())).toBeNull();
    expect(nextWake(add([], "k1"), ctx())).toBeNull();
  });
});

describe("atLaunch: bij elke start van de app (38b-5)", () => {
  // De taak bij de uploader heeft de generatie van de laatste links (punt 5).
  const job = (originalId: string, states: NativeJobView["parts"][number]["state"][]): NativeJobView => ({
    originalId,
    generation: gens.get(originalId) ?? 1,
    parts: states.map((state, i) => ({ partNumber: i + 1, state, status: null, code: null, attempts: 0 })),
  });

  it("iOS heeft de delen nog (wacht of bezig): niets opnieuw, geen startOriginal", () => {
    const q = sending();
    const { queue, effects } = atLaunch(q, { jobs: [job("o1", ["klaar", "bezig", "wacht"])], files: ["k1.mov"] }, T0 + HOUR);
    expect(effects).toEqual([]);
    expect(queue).toEqual(q);
    expect(nextCall(queue, ctx(T0 + HOUR))).toBeNull();
  });

  it("alle delen klaar terwijl de app weg was: afronden", () => {
    const { queue, effects } = atLaunch(sending(), { jobs: [job("o1", ["klaar", "klaar"])], files: ["k1.mov"] }, T0);
    expect(effects).toEqual([]);
    expect(nextCall(queue, ctx())).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });

  it("iOS-kant kwijt (geen taak in de wachtrij van de uploader): opnieuw aanmelden", () => {
    const { queue } = atLaunch(sending(), { jobs: [], files: ["k1.mov"] }, T0);
    expect(nextCall(queue, ctx())).toMatchObject({ kind: "start", key: "k1" });
  });

  it("een deel mislukte met 403 terwijl de app weg was: opnieuw aanmelden; met een serverfout: opnieuw bij iOS", () => {
    const q = sending();
    const j403: NativeJobView = {
      originalId: "o1",
      generation: gen("o1"),
      parts: [{ partNumber: 1, state: "mislukt", status: 403, code: "AccessDenied", attempts: 1 }],
    };
    expect(nextCall(atLaunch(q, { jobs: [j403], files: ["k1.mov"] }, T0).queue, ctx())).toMatchObject({ kind: "start" });

    const j503: NativeJobView = {
      originalId: "o1",
      generation: gen("o1"),
      parts: [
        { partNumber: 1, state: "klaar", status: 200, code: null, attempts: 0 },
        { partNumber: 2, state: "mislukt", status: 503, code: null, attempts: 1 },
      ],
    };
    const r = atLaunch(q, { jobs: [j503], files: ["k1.mov"] }, T0);
    expect(r.effects).toEqual([{ kind: "ios_opnieuw", originalId: "o1", partNumber: 2 }]);
    expect(nextCall(r.queue, ctx())).toBeNull();
  });

  it("een filmpje dat nog naar het album moest: die ronde is weg, dus het origineel ook", () => {
    const q = add([], "k1");
    const { queue, effects } = atLaunch(q, { jobs: [], files: ["k1.mov"] }, T0);
    expect(queue).toEqual([]);
    expect(effects).toEqual([{ kind: "bestand_weg", fileName: "k1.mov" }]);
  });

  it("wezen: een taak bij iOS of een bestand zonder origineel in de wachtrij gaat weg; die van een andere user blijven", () => {
    let q = sending("k1", "o1");
    q = sending("x1", "ox", T0, q, "user-2");
    const { queue, effects } = atLaunch(
      q,
      { jobs: [job("o1", ["bezig"]), job("ox", ["bezig"]), job("wees", ["wacht"])], files: ["k1.mov", "x1.mov", "los.mov"] },
      T0,
    );
    expect(queue).toEqual(q);
    expect(effects).toHaveLength(2);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "wees" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "los.mov" });
  });

  it("wachttijden en aanmelden of afronden blijven zoals ze waren", () => {
    const q = run(add([], "k1"), [
      { kind: "album_klaar", key: "k1", photoId: "photo-1" },
      { kind: "aangemeld", key: "k1", result: refused("vol") },
    ]).queue;
    const { queue, effects } = atLaunch(q, { jobs: [], files: ["k1.mov"] }, T0 + HOUR);
    expect(effects).toEqual([]);
    expect(queue).toEqual(q);
  });
});

describe("forgetUser: account verwijderd op dit toestel", () => {
  it("alle originelen van die user weg, met hun bestanden en iOS-taken; een andere user blijft", () => {
    let q = sending("k1", "o1");
    q = add(q, "k2");
    q = add(q, "x1", T0, "user-2");
    const { queue, effects } = forgetUser(q, U);
    expect(queue.map((e: QueueEntry) => e.key)).toEqual(["x1"]);
    expect(effects).toContainEqual({ kind: "ios_vergeten", originalId: "o1" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k1.mov" });
    expect(effects).toContainEqual({ kind: "bestand_weg", fileName: "k2.mov" });
    expect(effects.some((e: Effect) => e.kind === "bestand_weg" && e.fileName === "x1.mov")).toBe(false);
  });
});

describe("ownOriginalStand: de stand van een eigen origineel (voor de projectpagina, 38c)", () => {
  const wifi: NetworkView = { type: "wifi", expensive: false };
  const mobiel: NetworkView = { type: "mobiel", expensive: true };
  const hotspot: NetworkView = { type: "wifi", expensive: true };
  const stand = (queue: QueueEntry[], extra: Partial<{ status: "onderweg" | "binnen"; wifiOnly: boolean; network: NetworkView; now: number }> = {}) =>
    ownOriginalStand({ status: "onderweg", originalId: "o1", queue, wifiOnly: true, network: wifi, now: T0, ...extra });

  it("binnen volgens de backend: binnen", () => {
    expect(stand([], { status: "binnen" })).toBe("binnen");
    expect(stand(sending(), { status: "binnen" })).toBe("binnen");
  });

  it("onderweg maar niet in de wachtrij van dit toestel: elders", () => {
    expect(stand([])).toBe("elders");
  });

  it("delen bij iOS: wordt verstuurd op wifi; wacht op wifi op mobiel internet of een hotspot", () => {
    expect(stand(sending())).toBe("wordt_verstuurd");
    expect(stand(sending(), { network: mobiel })).toBe("wacht_op_wifi");
    expect(stand(sending(), { network: hotspot })).toBe("wacht_op_wifi");
    expect(stand(sending(), { network: mobiel, wifiOnly: false })).toBe("wordt_verstuurd");
  });

  it("aanmelden en afronden gaan op elk netwerk: niet wacht op wifi", () => {
    const fin = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    expect(stand(fin, { network: mobiel })).toBe("wordt_verstuurd");
  });

  it("een wachttijd (te_vaak, fout): wacht, tot hij om is", () => {
    const fin = run(sending(), [
      { kind: "delen_klaar", originalId: "o1", generation: HUIDIG },
      { kind: "afgerond", key: "k1", result: { kind: "geweigerd", reason: "te_vaak" } },
    ]).queue;
    expect(stand(fin)).toBe("wacht");
    expect(stand(fin, { now: T0 + HOUR })).toBe("wordt_verstuurd");
  });
});

describe("generaties van links (fix-cyclus 1, punt 5)", () => {
  /** Twee rondes links voor o1, op hetzelfde moment: na een 403 opnieuw aangemeld. */
  function twoRounds() {
    const first = run(add([], "k1"), [
      { kind: "album_klaar", key: "k1", photoId: "photo-1" },
      { kind: "aangemeld", key: "k1", result: upload("o1") },
    ]);
    const oud = gen("o1");
    const second = run(first.queue, [
      { kind: "deel_mislukt", originalId: "o1", generation: oud, partNumber: 4, status: 403, code: "AccessDenied", attempts: 1 },
      { kind: "aangemeld", key: "k1", result: upload("o1", [4, 5, 6, 7, 8, 9, 10]) },
    ]);
    return { queue: second.queue, effects: second.effects, oud, nieuw: gen("o1") };
  }

  it("elke ronde links een eigen generatie, ook op hetzelfde moment; aan_ios geeft hem mee", () => {
    const { effects, oud, nieuw } = twoRounds();
    expect(effects).toEqual([expect.objectContaining({ kind: "aan_ios", originalId: "o1", generation: nieuw })]);
    expect(Number.isFinite(oud)).toBe(true);
    expect(Number.isFinite(nieuw)).toBe(true);
    expect(nieuw).not.toBe(oud);
  });

  it("alle delen klaar met de oude links: telt niet; met de nieuwe wel", () => {
    const { queue, oud, nieuw } = twoRounds();
    expect(applyEvent(queue, { kind: "delen_klaar", originalId: "o1", generation: oud }, T0)).toEqual({ queue, effects: [] });
    const fresh = applyEvent(queue, { kind: "delen_klaar", originalId: "o1", generation: nieuw }, T0);
    expect(nextCall(fresh.queue, ctx())).toEqual({ kind: "finish", key: "k1", originalId: "o1" });
  });

  it.each([
    [403, "AccessDenied"],
    [403, "SignatureDoesNotMatch"],
    [404, "NoSuchUpload"],
  ])("een %i %s met de oude links: geen nieuwe aanmelding", (status, code) => {
    const { queue, oud } = twoRounds();
    const r = applyEvent(queue, { kind: "deel_mislukt", originalId: "o1", generation: oud, partNumber: 9, status, code, attempts: 1 }, T0);
    expect(r).toEqual({ queue, effects: [] });
    expect(nextCall(r.queue, ctx())).toBeNull();
  });

  it("een serverfout met de oude links: niet opnieuw bij iOS, en ook geen uur wachten", () => {
    const { queue, oud } = twoRounds();
    const once = applyEvent(queue, { kind: "deel_mislukt", originalId: "o1", generation: oud, partNumber: 9, status: 503, code: null, attempts: 1 }, T0);
    expect(once).toEqual({ queue, effects: [] });
    const often = applyEvent(queue, { kind: "deel_mislukt", originalId: "o1", generation: oud, partNumber: 9, status: 503, code: null, attempts: 5 }, T0);
    expect(often).toEqual({ queue, effects: [] });
  });

  it("met de nieuwe links telt een mislukking wel", () => {
    const { queue, nieuw } = twoRounds();
    const r = applyEvent(queue, { kind: "deel_mislukt", originalId: "o1", generation: nieuw, partNumber: 9, status: 503, code: null, attempts: 1 }, T0);
    expect(r.effects).toEqual([{ kind: "ios_opnieuw", originalId: "o1", partNumber: 9 }]);
  });

  it("bij de start heeft de uploader alleen de oude ronde (de app viel weg voordat de nieuwe links bij iOS waren): opnieuw aanmelden", () => {
    const { queue, oud } = twoRounds();
    const states: NativeJobView["parts"][number]["state"][][] = [
      ["klaar", "klaar", "klaar", "bezig", "wacht", "wacht", "wacht", "wacht", "wacht", "wacht"],
      ["klaar", "klaar", "klaar", "klaar", "klaar", "klaar", "klaar", "klaar", "klaar", "klaar"],
    ];
    for (const s of states) {
      const old: NativeJobView = {
        originalId: "o1",
        generation: oud,
        parts: s.map((state, i) => ({ partNumber: i + 1, state, status: null, code: null, attempts: 0 })),
      };
      const r = atLaunch(queue, { jobs: [old], files: ["k1.mov"] }, T0 + HOUR);
      expect(nextCall(r.queue, ctx(T0 + HOUR))).toEqual({ kind: "start", key: "k1", photoId: "photo-1", bytes: BYTES });
    }
  });
});

describe("geldigheid van de links vanaf het antwoord, niet met de klok van het toestel (fix-cyclus 1, punt 7)", () => {
  // De backend geeft links die ORIGINAL_PART_LINK_SECONDS (7 dagen) gelden.
  // `expiresAt` staat in de klok van de server; hier antwoordt de server op T0.
  const VALID = ORIGINAL_PART_LINK_SECONDS * 1000;
  const answer = () => upload("o1", undefined, T0 + VALID);

  it("de backend geeft links van 7 dagen", () => {
    expect(VALID).toBe(7 * DAY);
  });

  it.each([
    ["10 dagen voor", 10 * DAY],
    ["10 dagen achter", -10 * DAY],
    ["2 uur voor", 2 * HOUR],
    ["gelijk", 0],
  ])("de klok van het toestel loopt %s: nieuwe links pas als ze nog minder dan een dag gelden, gerekend vanaf het antwoord", (_label, skew) => {
    const now = T0 + skew;
    const q = run(add([], "k1", now), [
      { kind: "album_klaar", key: "k1", photoId: "photo-1" },
      { kind: "aangemeld", key: "k1", result: answer() },
    ], now).queue;
    expect(find(q, "k1")).toMatchObject({ step: "versturen" });
    expect(nextCall(q, ctx(now))).toBeNull();
    expect(nextCall(q, ctx(now + VALID - DAY))).toBeNull();
    expect(nextWake(q, ctx(now))).toBe(now + VALID - DAY + 1);
    expect(nextCall(q, ctx(now + VALID - DAY + 1))).toEqual({ kind: "start", key: "k1", photoId: "photo-1", bytes: BYTES });
  });

  it("de klok van het toestel loopt voor: bij de start blijven de bewaarde links gelden", () => {
    const now = T0 + 10 * DAY;
    const q = run(add([], "k1", now), [
      { kind: "album_klaar", key: "k1", photoId: "photo-1" },
      { kind: "aangemeld", key: "k1", result: answer() },
    ], now).queue;
    const job: NativeJobView = {
      originalId: "o1",
      generation: gen("o1"),
      parts: [{ partNumber: 1, state: "bezig", status: null, code: null, attempts: 0 }],
    };
    const r = atLaunch(q, { jobs: [job], files: ["k1.mov"] }, now + HOUR);
    expect(nextCall(r.queue, ctx(now + HOUR))).toBeNull();
  });
});

describe("oplopend wachten na een fout (fix-cyclus 1, punt 8)", () => {
  /** Zoveel fouten op rij; geeft de wachttijd na elke fout. */
  function waits(start: QueueEntry[], fout: QueueEvent, call: object, n = 12): number[] {
    let q = start;
    let now = T0;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      q = applyEvent(q, fout, now).queue;
      const wake = nextWake(q, ctx(now));
      expect(wake).not.toBeNull();
      out.push(wake! - now);
      expect(nextCall(q, ctx(wake! - 1))).toBeNull();
      expect(nextCall(q, ctx(wake!))).toMatchObject(call);
      now = wake!;
    }
    return out;
  }

  function rising(w: number[]) {
    expect(w[0]).toBe(MINUTE);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]).toBeLessThanOrEqual(HOUR);
      if (w[i - 1]! < HOUR) expect(w[i]).toBeGreaterThan(w[i - 1]!);
      else expect(w[i]).toBe(HOUR);
    }
    // Uiterlijk bij de tiende fout op rij een uur (A-keuze).
    expect(w[9]).toBe(HOUR);
  }

  it("aanmelden: 1 minuut, daarna steeds langer, tot een uur", () => {
    const ready = run(add([], "k1"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]).queue;
    rising(waits(ready, { kind: "aangemeld", key: "k1", result: { kind: "fout" } }, { kind: "start", key: "k1" }));
  });

  it("afronden: 1 minuut, daarna steeds langer, tot een uur", () => {
    const fin = run(sending(), [{ kind: "delen_klaar", originalId: "o1", generation: HUIDIG }]).queue;
    rising(waits(fin, { kind: "afgerond", key: "k1", result: { kind: "fout" } }, { kind: "finish", key: "k1" }));
  });

  it("na een gelukte aanroep begint het weer bij 1 minuut", () => {
    let q = run(add([], "k1"), [{ kind: "album_klaar", key: "k1", photoId: "photo-1" }]).queue;
    const fout: QueueEvent = { kind: "aangemeld", key: "k1", result: { kind: "fout" } };
    let now = T0;
    for (let i = 0; i < 4; i++) {
      q = applyEvent(q, fout, now).queue;
      now = nextWake(q, ctx(now))!;
    }
    q = run(q, [
      { kind: "aangemeld", key: "k1", result: upload("o1") },
      { kind: "deel_mislukt", originalId: "o1", generation: HUIDIG, partNumber: 2, status: 403, code: "AccessDenied", attempts: 1 },
      fout,
    ], now).queue;
    expect(nextWake(q, ctx(now))).toBe(now + MINUTE);
  });
});

describe("de wachtrij op schijf, met een versie (fix-cyclus 1, punt 9)", () => {
  /** Van elke stap een: album, aanmelden met een wachttijd, versturen, afronden. */
  function sample(): QueueEntry[] {
    let q = add([], "a1");
    q = run(add(q, "w1", T0 + 1), [
      { kind: "album_klaar", key: "w1", photoId: "photo-w1" },
      { kind: "aangemeld", key: "w1", result: refused("vol") },
    ]).queue;
    q = sending("v1", "ov", T0 + 2, q);
    q = run(sending("f1", "of", T0 + 3, q), [{ kind: "delen_klaar", originalId: "of", generation: HUIDIG }]).queue;
    return q;
  }

  /** Een latere versie van de app zet er velden bij, overal. */
  function withExtraFields(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(withExtraFields);
    if (typeof v === "object" && v !== null) {
      const out: Record<string, unknown> = { nieuwVeld: "uit een latere versie" };
      for (const [k, x] of Object.entries(v)) out[k] = withExtraFields(x);
      return out;
    }
    return v;
  }

  it("terug te lezen zoals hij was, ook wachttijden, generaties en de geldigheid van de links", () => {
    const q = sample();
    const back = queueFromStore(queueToStore(q));
    expect(back).toEqual({ queue: q, broken: false });
    for (const t of [T0, T0 + 2 * DAY, T0 + 6 * DAY + 10]) {
      expect(nextCall(back.queue, ctx(t))).toEqual(nextCall(q, ctx(t)));
      expect(nextWake(back.queue, ctx(t))).toEqual(nextWake(q, ctx(t)));
    }
  });

  it("met een versie (een geheel getal vanaf 1)", () => {
    const stored: unknown = JSON.parse(queueToStore(sample()));
    expect(stored).toEqual(expect.objectContaining({ version: expect.any(Number) }));
    const version = (stored as { version: number }).version;
    expect(Number.isInteger(version) && version >= 1).toBe(true);
  });

  it("niets bewaard: leeg, niet kapot", () => {
    expect(queueFromStore(null)).toEqual({ queue: [], broken: false });
    expect(queueToStore([])).not.toBe("");
    expect(queueFromStore(queueToStore([]))).toEqual({ queue: [], broken: false });
  });

  it.each(["kapot{", "42", "null", "{}", '"tekst"', ""])("onleesbaar (%j): leeg en kapot", (raw) => {
    expect(queueFromStore(raw)).toEqual({ queue: [], broken: true });
  });

  it("een latere versie met velden erbij: wat deze app kent, blijft en werkt", () => {
    const q = sample();
    const stored = JSON.parse(queueToStore(q)) as { version: number };
    const newer = withExtraFields(stored) as { version: number };
    newer.version = stored.version + 1;
    const back = queueFromStore(JSON.stringify(newer));
    expect(back.broken).toBe(false);
    expect(back.queue).toHaveLength(q.length);
    back.queue.forEach((e, i) => expect(e).toMatchObject(q[i]!));
    expect(nextCall(back.queue, ctx(T0 + DAY))).toEqual(nextCall(q, ctx(T0 + DAY)));
  });
});
