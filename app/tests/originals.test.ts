import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueFromStore } from "../src/lib/originalQueue";

// WP38b fix-cyclus 1: de runner van de wachtrij (src/data/originals.ts), met
// een nagebootste uploader en een nagebootste Convex-client.
//   - Punt 2: nooit twee aanroepen tegelijk (`startOriginal`, `finishOriginal`),
//     ook niet als een aanroep lang niets geeft. De Convex-client houdt een
//     action vast tot hij weer verbinding heeft; een eigen time-out mag dan
//     geen nieuwe aanroep starten.
//   - Punt 3: een origineel dat wordt toegevoegd terwijl de wachtrij nog laadt,
//     blijft staan: het laden wist niets wat in dit proces is aangemaakt.
//   - Punt 4: Account verwijderen terwijl de wachtrij niet laadt: de user wordt
//     onthouden en gewist zodra het laden lukt. Het verwijderen wacht niet.
//   - Punt 6: "Alleen via wifi" bij twijfel aan: verschillen de app en de
//     uploader, of lukt het bewaren niet, dan blijft hij aan.
//   - Punt 9: de wachtrij staat op schijf met een versie (queueToStore); een
//     onleesbare wachtrij geeft een regel in het log.
//
// Het nep-toestel houdt zijn bestanden en opslag over een "herstart" heen
// (een verse import van de runner). De namen van de bestanden in de opslag
// zijn aan B; de tests kijken alleen naar wat erin staat.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b en
// §38b fix-cyclus 1.

const dev = vi.hoisted(() => ({
  state: new Map<string, string>(),
  files: new Set<string>(),
  jobs: [] as unknown[],
  nativeWifi: true,
  nativeWifiUnreadable: false,
  readGate: null as Promise<void> | null,
  readFails: false,
  writeFails: false,
  setWifiFails: false,
  removed: [] as string[],
  forgotten: [] as string[],
  sent: [] as unknown[],
  notes: [] as string[],
}));

vi.mock("../modules/clubalmanac-video", () => ({
  videoModuleAvailable: true,
  originalUploaderAvailable: true,
  listenUploader: () => () => {},
  networkStatus: async () => ({ type: "wifi", expensive: false }),
  readOriginalState: async (name: string) => {
    if (dev.readGate) await dev.readGate;
    if (dev.readFails) throw new Error("bestand op slot");
    return dev.state.get(name) ?? null;
  },
  writeOriginalState: async (name: string, text: string) => {
    if (dev.writeFails) throw new Error("schrijven lukte niet");
    dev.state.set(name, text);
  },
  listOriginals: async () => [...dev.files],
  removeOriginal: async (fileName: string) => {
    dev.removed.push(fileName);
    dev.files.delete(fileName);
  },
  keepOriginal: async () => {
    throw new Error("niet in deze test");
  },
  originalInfo: async (fileName: string) => ({ uri: fileName, exists: dev.files.has(fileName), bytes: 0 }),
  originalSha256: async () => "",
  freeBytes: async () => null,
  partsBytes: async () => 0,
  uploaderSend: async (job: unknown) => {
    dev.sent.push(job);
  },
  uploaderRetryPart: async () => {},
  uploaderForget: async (originalId: string) => {
    dev.forgotten.push(originalId);
  },
  uploaderJobs: async () => dev.jobs,
  uploaderWifiOnly: async () => {
    if (dev.nativeWifiUnreadable) throw new Error("opslag van de uploader onleesbaar");
    return dev.nativeWifi;
  },
  uploaderSetWifiOnly: async (on: boolean) => {
    if (dev.setWifiFails) throw new Error("omzetten lukte niet");
    dev.nativeWifi = on;
  },
  uploaderNote: async (text: string) => {
    dev.notes.push(text);
  },
  uploaderLog: async () => [],
  uploaderClearLog: async () => {},
  backgroundWorkBegin: async () => 1,
  backgroundWorkEnd: async () => {},
  withBackgroundWork: <T,>(work: () => Promise<T>) => work(),
}));

type Runner = typeof import("../src/data/originals");
type Actions = Parameters<Runner["setOriginalsSession"]>[0] & {};

const MiB = 1024 * 1024;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const U = "user-1";
const U2 = "user-2";

let R: Runner;

/** Laat beloftes en timers tot `ms` verder lopen. */
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  if (ms > 0) await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Een verse start van de app: het toestel houdt wat erop staat. */
async function startApp(): Promise<void> {
  vi.clearAllTimers();
  vi.resetModules();
  R = await import("../src/data/originals");
  R.startOriginals();
  await settle();
}

const upload = (photoId: string, parts: number[] = [1]) => ({
  kind: "upload" as const,
  originalId: `o-${photoId}`,
  partSize: 32 * MiB,
  parts: parts.map((n) => ({ partNumber: n, url: `https://r2.invalid/${photoId}/${n}` })),
  expiresAt: Date.now() + 7 * DAY,
});

type Behaviour = "hang" | "valt_weg" | "upload" | "upload_leeg" | "vol";

/**
 * Een nagebootste Convex-client. Telt hoeveel aanroepen er tegelijk uit
 * staan (verstuurd en nog zonder uitkomst).
 * - hang: geeft niets, tot de test hem afhandelt (offline);
 * - valt_weg: na anderhalf uur "Connection lost" (de client geeft het op);
 * - upload: links voor één deel; upload_leeg: links zonder delen (afronden);
 * - vol: geweigerd met `vol`.
 */
function client(behaviour: { start: Behaviour; finish: Behaviour }) {
  const stats = { start: 0, finish: 0, out: 0, maxOut: 0 };
  const pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const track = <T,>(p: Promise<T>): Promise<T> => {
    stats.out += 1;
    stats.maxOut = Math.max(stats.maxOut, stats.out);
    return p.finally(() => {
      stats.out -= 1;
    });
  };
  const answer = (b: Behaviour, photoId: string): Promise<unknown> => {
    switch (b) {
      case "hang":
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      case "valt_weg":
        return new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("Connection lost while action was in flight")), 90 * MINUTE),
        );
      case "upload":
        return Promise.resolve(upload(photoId));
      case "upload_leeg":
        return Promise.resolve(upload(photoId, []));
      case "vol":
        return Promise.reject(new ConvexError({ code: "ORIGINAL_REFUSED", reason: "vol" }));
    }
  };
  const actions = {
    startOriginal: (args: { photoId: string }) => {
      stats.start += 1;
      return track(answer(behaviour.start, args.photoId));
    },
    finishOriginal: () => {
      stats.finish += 1;
      return track(answer(behaviour.finish, ""));
    },
  } as unknown as Actions;
  return { actions, stats, pending };
}

/** Het toevoegscherm: de kopie staat in de map, het origineel in de wachtrij, het filmpje in het album. */
async function addVideo(key: string, userId = U): Promise<void> {
  dev.files.add(`${key}.mov`);
  const ok = await R.addOriginalToQueue({ key, userId, projectId: "p1", fileName: `${key}.mov`, bytes: 5 * MiB });
  expect(ok).toBe(true);
  R.originalEvent({ kind: "album_klaar", key, photoId: `photo-${key}` });
  await settle();
}

const keys = () => R.originalsSnapshot().queue.map((e) => e.key).sort();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  dev.state.clear();
  dev.files.clear();
  dev.jobs = [];
  dev.nativeWifi = true;
  dev.nativeWifiUnreadable = false;
  dev.readGate = null;
  dev.readFails = false;
  dev.writeFails = false;
  dev.setWifiFails = false;
  dev.removed = [];
  dev.forgotten = [];
  dev.sent = [];
  dev.notes = [];
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("nooit twee aanroepen tegelijk (fix-cyclus 1, punt 2)", () => {
  it("een aanmelding die blijft hangen (offline): geen tweede, ook niet na een time-out, bij terugkomst of een nieuwe sessie", async () => {
    await startApp();
    const c = client({ start: "hang", finish: "hang" });
    await addVideo("k1");
    R.setOriginalsSession(c.actions, U);
    await settle();
    expect(c.stats.start).toBe(1);

    for (let i = 0; i < 36; i++) {
      await settle(5 * MINUTE);
      R.nudgeOriginals();
      if (i % 6 === 3) {
        R.setOriginalsSession(null, null);
        R.setOriginalsSession(c.actions, U);
      }
      await settle();
    }
    expect(c.stats.maxOut).toBe(1);
    expect(c.stats.start).toBe(1);

    // Weer verbinding: het antwoord komt alsnog en telt; de delen gaan naar iOS.
    c.pending[0]!.resolve(upload("photo-k1"));
    await settle();
    expect(dev.sent).toHaveLength(1);
    expect(c.stats.maxOut).toBe(1);
  });

  it("een afronding die blijft hangen: geen tweede", async () => {
    await startApp();
    const c = client({ start: "upload_leeg", finish: "hang" });
    await addVideo("k1");
    R.setOriginalsSession(c.actions, U);
    await settle();
    expect(c.stats.finish).toBe(1);

    for (let i = 0; i < 36; i++) {
      await settle(5 * MINUTE);
      R.nudgeOriginals();
    }
    expect(c.stats.finish).toBe(1);
    expect(c.stats.maxOut).toBe(1);
  });

  it("de client geeft elke aanroep na anderhalf uur op: steeds één tegelijk, en daarna wel een nieuwe poging", async () => {
    await startApp();
    const c = client({ start: "valt_weg", finish: "valt_weg" });
    await addVideo("k1");
    await addVideo("k2");
    R.setOriginalsSession(c.actions, U);
    for (let i = 0; i < 72; i++) {
      await settle(5 * MINUTE);
      R.nudgeOriginals();
    }
    expect(c.stats.maxOut).toBe(1);
    expect(c.stats.start).toBeGreaterThanOrEqual(2);
  });
});

describe("toevoegen terwijl de wachtrij nog laadt (fix-cyclus 1, punt 3)", () => {
  it("het laden wist het nieuwe origineel en zijn bestand niet; een echt wees-bestand wel", async () => {
    let release!: () => void;
    dev.readGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    dev.files.add("los.mov");
    vi.resetModules();
    R = await import("../src/data/originals");
    R.startOriginals();
    await settle();

    // Het toevoegscherm verplaatst de kopie en zet het origineel in de wachtrij.
    dev.files.add("k9.mov");
    const added = R.addOriginalToQueue({ key: "k9", userId: U, projectId: "p1", fileName: "k9.mov", bytes: 5 * MiB });
    await settle();

    dev.readGate = null;
    release();
    await settle();

    expect(await added).toBe(true);
    expect(dev.removed).not.toContain("k9.mov");
    expect(dev.files.has("k9.mov")).toBe(true);
    expect(dev.removed).toContain("los.mov");

    // Het origineel staat nog in de wachtrij en gaat gewoon verder.
    const c = client({ start: "upload", finish: "hang" });
    R.originalEvent({ kind: "album_klaar", key: "k9", photoId: "photo-k9" });
    R.setOriginalsSession(c.actions, U);
    await settle();
    expect(keys()).toEqual(["k9"]);
    expect(c.stats.start).toBe(1);
    expect(dev.sent).toHaveLength(1);
  });
});

describe("Account verwijderen terwijl de wachtrij niet laadt (fix-cyclus 1, punt 4)", () => {
  /** Twee users met elk een origineel dat op afronden wacht (`vol`: een dag). */
  async function twoUsers(): Promise<void> {
    await startApp();
    const c = client({ start: "upload_leeg", finish: "vol" });
    R.setOriginalsSession(c.actions, U);
    await addVideo("k1", U);
    R.setOriginalsSession(c.actions, U2);
    await addVideo("x1", U2);
    R.setOriginalsSession(null, null);
    await settle();
    expect(keys()).toEqual(["k1", "x1"]);
    expect(R.originalsSnapshot().queue.every((e) => e.originalId !== null)).toBe(true);
  }

  it("het verwijderen wacht niet; zodra het laden lukt, gaat alles van die user weg en blijft de andere", async () => {
    await twoUsers();

    dev.readFails = true; // na een herstart nog op slot
    await startApp();
    let done = false;
    void R.forgetOriginalsOf(U).then(() => {
      done = true;
    });
    await settle(1000);
    expect(done).toBe(true);

    dev.readFails = false;
    R.nudgeOriginals();
    await settle(2 * MINUTE);
    expect(dev.removed).toContain("k1.mov");
    expect(dev.removed).not.toContain("x1.mov");
    expect(dev.forgotten).toContain("o-photo-k1");
    expect(dev.forgotten).not.toContain("o-photo-x1");
    expect(keys()).toEqual(["x1"]);

    // Ook na de volgende start komt k1 niet terug.
    await startApp();
    expect(keys()).toEqual(["x1"]);
  });

  it("lukt het laden meteen, dan is het gewoon weg (zoals in 38b-4)", async () => {
    await twoUsers();
    await startApp();
    await R.forgetOriginalsOf(U);
    await settle();
    expect(dev.removed).toContain("k1.mov");
    expect(keys()).toEqual(["x1"]);
  });
});

describe('"Alleen via wifi" bij twijfel aan (fix-cyclus 1, punt 6)', () => {
  it("de app bewaarde uit, de uploader zegt aan: aan, en de uploader blijft aan", async () => {
    await startApp();
    await R.setOriginalsWifiOnly(false);
    expect(R.originalsSnapshot().wifiOnly).toBe(false);
    expect(dev.nativeWifi).toBe(false);

    dev.nativeWifi = true; // de uploader verloor zijn stand
    await startApp();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
    expect(dev.nativeWifi).toBe(true);
  });

  it("de uploader kan zijn stand niet geven: aan", async () => {
    await startApp();
    await R.setOriginalsWifiOnly(false);
    dev.nativeWifiUnreadable = true;
    await startApp();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
  });

  it("de app bewaarde niets, de uploader zegt uit: aan, en de uploader gaat aan", async () => {
    dev.nativeWifi = false;
    await startApp();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
    expect(dev.nativeWifi).toBe(true);
  });

  it("beide uit: na een herstart uit", async () => {
    await startApp();
    await R.setOriginalsWifiOnly(false);
    await startApp();
    expect(R.originalsSnapshot().wifiOnly).toBe(false);
    expect(dev.nativeWifi).toBe(false);
  });

  it("uitzetten terwijl bewaren niet lukt: de stand blijft aan, ook bij de uploader", async () => {
    await startApp();
    dev.writeFails = true;
    await R.setOriginalsWifiOnly(false);
    await settle();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
    expect(dev.nativeWifi).toBe(true);
  });

  it("uitzetten terwijl de uploader het niet aanneemt: de stand blijft aan", async () => {
    await startApp();
    dev.setWifiFails = true;
    await R.setOriginalsWifiOnly(false);
    await settle();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
    expect(dev.nativeWifi).toBe(true);
  });

  it("aanzetten terwijl bewaren niet lukt: aan, ook bij de uploader", async () => {
    await startApp();
    await R.setOriginalsWifiOnly(false);
    dev.writeFails = true;
    await R.setOriginalsWifiOnly(true);
    await settle();
    expect(R.originalsSnapshot().wifiOnly).toBe(true);
    expect(dev.nativeWifi).toBe(true);
  });
});

describe("de wachtrij op schijf (fix-cyclus 1, punt 9)", () => {
  it("de runner bewaart de wachtrij met een versie (queueToStore)", async () => {
    await startApp();
    await addVideo("k1");
    const stored = [...dev.state.values()].map((raw) => queueFromStore(raw)).filter((r) => !r.broken && r.queue.length > 0);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.queue.map((e) => e.key)).toEqual(["k1"]);
  });

  it("een onleesbare wachtrij: een regel in het log; een leesbare niet", async () => {
    await startApp();
    await addVideo("k1");

    dev.notes = [];
    await startApp();
    expect(dev.notes.some((n) => /onleesbaar/i.test(n))).toBe(false);

    for (const name of [...dev.state.keys()]) dev.state.set(name, "kapot{");
    dev.notes = [];
    await startApp();
    expect(dev.notes.some((n) => /onleesbaar/i.test(n))).toBe(true);
  });
});
