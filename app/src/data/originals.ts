import type { FunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  listenUploader,
  listOriginals,
  networkStatus,
  originalUploaderAvailable,
  readOriginalState,
  removeOriginal,
  uploaderForget,
  uploaderJobs,
  uploaderNote,
  uploaderRetryPart,
  uploaderSend,
  uploaderSetWifiOnly,
  withBackgroundWork,
  writeOriginalState,
  type NativeNetwork,
} from "../../modules/clubalmanac-video";
import type { api } from "../convexApi";
import { withOneRetry } from "../lib/actionRetry";
import {
  addOriginal,
  applyEvent,
  atLaunch,
  forgetUser,
  nextCall,
  nextWake,
  type Effect,
  type FinishResult,
  type NextCall,
  type QueueEntry,
  type QueueEvent,
  type QueueStep,
  type StartResult,
} from "../lib/originalQueue";
import { originalRefusal, wifiOnlyFromStore, wifiOnlyToStore, type NetworkView } from "../lib/originalUpload";

// WP38b: de runner van de wachtrij met originelen (src/lib/originalQueue.ts).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b,
// invarianten 38b-3 tot 38b-11.
//
// - Eén runner voor de hele app, gestart vanuit de wortel (OriginalsRunner),
//   ook als iOS de app op de achtergrond start; niet vanuit een scherm. In de
//   webapp en in een build zonder uploader draait hij niet.
// - De wachtrij staat op schijf (in de map van de module: na de eerste
//   ontgrendeling leesbaar, ook op de achtergrond) en overleeft een herstart.
//   Bij het laden legt hij de wachtrij naast de uploader (`atLaunch`).
// - Alles wat de wachtrij verandert (events van de uploader, toevoegen,
//   resultaten van aanroepen) loopt na elkaar; daarna past hij de effecten toe
//   op de uploader en de bestanden.
// - Eén aanroep tegelijk (`startOriginal` of `finishOriginal`), alleen voor de
//   user die nu is ingelogd; daarna de volgende (`nextCall`), of een wekker op
//   `nextWake`. Valt de verbinding weg, dan één nieuwe poging (WP37).
// - Uitloggen pauzeert alleen; Account verwijderen wist alles van die user.
// - Geen link, sleutel of pad in het log: alleen inzending-id, deelnummer,
//   status en reden (38b-16).

const QUEUE_FILE = "queue.json";
const WIFI_FILE = "wifi-only.txt";
/** Een aanroep die zo lang niets geeft, telt als fout (de client wacht anders tot hij weer verbonden is). */
const CALL_TIMEOUT_MS = 60_000;
/** Lukte het laden niet (bv. de telefoon nog op slot na een herstart), dan zo opnieuw. */
const LOAD_RETRY_MS = 60_000;
/** Een wekker verder dan dit in de toekomst zet de runner niet: hij kijkt dan opnieuw. */
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

export type OriginalsSnapshot = {
  loaded: boolean;
  queue: readonly QueueEntry[];
  wifiOnly: boolean;
  network: NetworkView;
  userId: string | null;
};

type Listener = () => void;

type ActionFn<F extends FunctionReference<"action">> = (args: F["_args"]) => Promise<F["_returnType"]>;

/** De aanroepen van de runner, uit `useAction` in de wortel (OriginalsRunner). */
export type OriginalsActions = {
  startOriginal: ActionFn<typeof api.filmProjects.startOriginal>;
  finishOriginal: ActionFn<typeof api.filmProjects.finishOriginal>;
};

const NETWORK_TYPES: readonly NetworkView["type"][] = ["wifi", "mobiel", "kabel", "geen", "anders", "onbekend"];

function toNetworkView(n: NativeNetwork | null | undefined): NetworkView {
  const type = NETWORK_TYPES.find((t) => t === n?.type) ?? "onbekend";
  return { type, expensive: n?.expensive === true };
}

function isEntry(v: unknown): v is QueueEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  const str = (k: string) => typeof e[k] === "string" && e[k] !== "";
  const strOrNull = (k: string) => e[k] === null || typeof e[k] === "string";
  const numOrNull = (k: string) => e[k] === null || typeof e[k] === "number";
  return (
    str("key") &&
    str("userId") &&
    str("projectId") &&
    str("fileName") &&
    typeof e.bytes === "number" &&
    strOrNull("photoId") &&
    strOrNull("originalId") &&
    (e.step === "album" || e.step === "aanmelden" || e.step === "versturen" || e.step === "afronden") &&
    typeof e.addedAt === "number" &&
    numOrNull("waitUntil") &&
    numOrNull("busyUntil") &&
    numOrNull("expiresAt") &&
    typeof e.rounds === "number" &&
    numOrNull("lastMissing")
  );
}

function parseQueue(raw: string | null): QueueEntry[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function describeEvent(event: QueueEvent): string | null {
  switch (event.kind) {
    case "aangemeld": {
      const r = event.result;
      if (r.kind === "upload") return `startOriginal ${r.originalId}: ${r.parts.length} links`;
      if (r.kind === "done") return `startOriginal ${r.originalId}: al binnen`;
      return `startOriginal: ${r.kind === "geweigerd" ? r.reason : "fout"}`;
    }
    case "afgerond": {
      const r = event.result;
      if (r.kind === "missing") return `finishOriginal: delen ontbreken (${r.parts.join(", ")})`;
      return `finishOriginal: ${r.kind === "geweigerd" ? r.reason : r.kind === "done" ? "binnen" : "fout"}`;
    }
    case "album_klaar":
      return "filmpje in het album: aanmelden";
    case "album_mislukt":
      return "filmpje niet in het album: origineel weg";
    case "teruggetrokken":
      return `${event.originalId}: teruggetrokken`;
    case "bestand_kapot":
      return "bewaard bestand kapot of weg: origineel weg";
    default:
      return null;
  }
}

class OriginalRunner {
  private queue: QueueEntry[] = [];
  private loaded = false;
  private loading: Promise<boolean> | null = null;
  private wifiOnly = true;
  private network: NetworkView = { type: "onbekend", expensive: false };
  private chain: Promise<void> = Promise.resolve();
  private client: OriginalsActions | null = null;
  private userId: string | null = null;
  private calling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  /** Per inzending de deelgrootte en geldigheid uit het laatste antwoord van `startOriginal`. */
  private links = new Map<string, { partSize: number; expiresAt: number }>();
  private snap: OriginalsSnapshot = {
    loaded: false,
    queue: [],
    wifiOnly: true,
    network: this.network,
    userId: null,
  };

  // --- buiten ----------------------------------------------------------------------

  start(): void {
    if (this.started || !originalUploaderAvailable) return;
    this.started = true;
    listenUploader({
      partFailed: (e) =>
        this.dispatch({
          kind: "deel_mislukt",
          originalId: e.originalId,
          partNumber: e.partNumber,
          status: typeof e.status === "number" ? e.status : null,
          code: typeof e.code === "string" ? e.code : null,
          attempts: typeof e.attempts === "number" ? e.attempts : 1,
        }),
      allPartsDone: (e) => this.dispatch({ kind: "delen_klaar", originalId: e.originalId }),
      fileBroken: (e) => {
        void this.run(async () => {
          const entry = this.queue.find((q) => q.originalId === e.originalId);
          if (entry) await this.apply({ kind: "bestand_kapot", key: entry.key });
        });
      },
      network: (n) => {
        this.network = toNetworkView(n);
        this.changed();
      },
    });
    void networkStatus()
      .then((n) => {
        this.network = toNetworkView(n);
        this.changed();
      })
      .catch(() => {});
    void this.run(async () => {});
  }

  setSession(client: OriginalsActions | null, userId: string | null): void {
    this.client = client;
    this.userId = userId;
    this.changed();
    this.nudge();
  }

  /** De app is weer actief, of iets anders kan nu misschien verder. */
  nudge(): void {
    if (!this.started) return;
    if (!this.loaded) {
      void this.run(async () => {});
      return;
    }
    void this.pump();
  }

  /** 38b-3: het origineel bij "Toevoegen", met als stap: wacht op het album. */
  add(input: { key: string; userId: string; projectId: string; fileName: string; bytes: number }): Promise<boolean> {
    return this.run(async () => {
      this.queue = addOriginal(this.queue, input, Date.now());
      await this.save();
      this.note(`origineel in de wachtrij (${Math.round(input.bytes / 1048576)} MiB)`);
    });
  }

  dispatch(event: QueueEvent): void {
    void this.run(() => this.apply(event));
  }

  /** Account verwijderd op dit toestel: alles van die user weg (38b-4). */
  forgetUser(userId: string): Promise<boolean> {
    return this.run(async () => {
      const step = forgetUser(this.queue, userId);
      await this.commit(step);
    });
  }

  setWifiOnly(on: boolean): Promise<boolean> {
    return this.run(async () => {
      this.wifiOnly = on;
      this.changed();
      try {
        await writeOriginalState(WIFI_FILE, wifiOnlyToStore(on));
      } catch {
        // Stil: de uploader onthoudt hem ook.
      }
      await uploaderSetWifiOnly(on);
    });
  }

  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): OriginalsSnapshot {
    return this.snap;
  }

  // --- binnen ----------------------------------------------------------------------

  private changed(): void {
    this.snap = {
      loaded: this.loaded,
      queue: this.queue,
      wifiOnly: this.wifiOnly,
      network: this.network,
      userId: this.userId,
    };
    for (const l of this.listeners) l();
  }

  private note(text: string): void {
    void uploaderNote(text).catch(() => {});
  }

  /** Na elkaar, na het laden. `false`: niet geladen (dan gebeurde er niets). */
  private run(work: () => Promise<void>): Promise<boolean> {
    const next = this.chain.then(async () => {
      if (!(await this.ensureLoaded())) return false;
      try {
        await work();
      } catch {
        // Een fout in één stap houdt de rij niet op.
      }
      return true;
    });
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    void next.then((ok) => {
      if (ok) void this.pump();
    });
    return next;
  }

  private ensureLoaded(): Promise<boolean> {
    if (this.loaded) return Promise.resolve(true);
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async load(): Promise<boolean> {
    let raw: string | null;
    let wifi: string | null;
    try {
      raw = await readOriginalState(QUEUE_FILE);
      wifi = await readOriginalState(WIFI_FILE);
    } catch {
      // Nog op slot of een andere leesfout: niets overschrijven, later opnieuw.
      this.schedule(Date.now() + LOAD_RETRY_MS);
      return false;
    }
    this.queue = parseQueue(raw);
    this.wifiOnly = wifiOnlyFromStore(wifi);
    try {
      await uploaderSetWifiOnly(this.wifiOnly);
    } catch {
      // De uploader houdt zijn eigen stand.
    }
    let jobs: Awaited<ReturnType<typeof uploaderJobs>>;
    let files: string[];
    try {
      jobs = await uploaderJobs();
      files = await listOriginals();
    } catch {
      this.schedule(Date.now() + LOAD_RETRY_MS);
      return false;
    }
    this.loaded = true;
    const step = atLaunch(this.queue, { jobs, files }, Date.now());
    await this.commit(step);
    // Een kapot bestand dat de uploader al zag terwijl de app er niet was.
    for (const job of jobs) {
      if (!job.broken) continue;
      const entry = this.queue.find((e) => e.originalId === job.originalId);
      if (entry) await this.commit(applyEvent(this.queue, { kind: "bestand_kapot", key: entry.key }, Date.now()));
    }
    this.note(`wachtrij geladen: ${this.queue.length} originelen`);
    this.changed();
    return true;
  }

  private async apply(event: QueueEvent): Promise<void> {
    if (event.kind === "aangemeld" && event.result.kind === "upload") {
      this.links.set(event.result.originalId, { partSize: event.result.partSize, expiresAt: event.result.expiresAt });
    }
    const before = this.queue;
    const step = applyEvent(this.queue, event, Date.now());
    if (step.queue === before && step.effects.length === 0) return;
    const text = describeEvent(event);
    if (text) this.note(text);
    await this.commit(step);
  }

  private async commit(step: QueueStep): Promise<void> {
    this.queue = step.queue;
    await this.save();
    this.changed();
    for (const effect of step.effects) await this.effect(effect);
  }

  private async save(): Promise<void> {
    try {
      await writeOriginalState(QUEUE_FILE, JSON.stringify(this.queue));
    } catch {
      // Dan blijft hij in het geheugen; de volgende stap probeert het opnieuw.
    }
  }

  private async effect(effect: Effect): Promise<void> {
    try {
      switch (effect.kind) {
        case "aan_ios": {
          const entry = this.queue.find((e) => e.originalId === effect.originalId);
          const links = this.links.get(effect.originalId);
          if (!entry || !links) return;
          try {
            await uploaderSend({
              originalId: effect.originalId,
              fileName: effect.fileName,
              totalBytes: entry.bytes,
              partSize: links.partSize,
              expiresAt: links.expiresAt,
              parts: effect.parts,
            });
          } catch {
            // De uploader neemt het niet aan (het bestand klopt niet meer): weg.
            await this.commit(applyEvent(this.queue, { kind: "bestand_kapot", key: entry.key }, Date.now()));
          }
          return;
        }
        case "ios_opnieuw":
          await uploaderRetryPart(effect.originalId, effect.partNumber);
          return;
        case "ios_vergeten":
          this.links.delete(effect.originalId);
          await uploaderForget(effect.originalId);
          return;
        case "bestand_weg":
          await removeOriginal(effect.fileName);
          return;
      }
    } catch {
      // Een effect dat mislukt, ruimt de volgende start op (wezen in atLaunch).
    }
  }

  private schedule(at: number | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (at === null) return;
    const ms = Math.min(Math.max(0, at - Date.now()), MAX_TIMER_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nudge();
    }, ms);
  }

  private async pump(): Promise<void> {
    if (!this.loaded || this.calling) return;
    const client = this.client;
    const userId = this.userId;
    const now = Date.now();
    const call = client ? nextCall(this.queue, { now, userId }) : null;
    if (!call || !client) {
      this.schedule(client ? nextWake(this.queue, { now, userId }) : null);
      return;
    }
    this.schedule(null);
    this.calling = true;
    try {
      let event: QueueEvent;
      try {
        event = await withBackgroundWork(() => this.perform(client, call));
      } catch {
        event =
          call.kind === "start"
            ? { kind: "aangemeld", key: call.key, result: { kind: "fout" } }
            : { kind: "afgerond", key: call.key, result: { kind: "fout" } };
      }
      // Pas na het verwerken van de uitkomst de volgende aanroep (38b-7: één tegelijk).
      await this.run(() => this.apply(event));
    } finally {
      this.calling = false;
    }
    void this.pump();
  }

  private async perform(client: OriginalsActions, call: NextCall): Promise<QueueEvent> {
    if (call.kind === "start") {
      let result: StartResult;
      try {
        result = await timeout(
          withOneRetry(() => client.startOriginal({ photoId: call.photoId as Id<"photos">, bytes: call.bytes })),
          CALL_TIMEOUT_MS,
        );
      } catch (e) {
        result = originalRefusal(e);
      }
      return { kind: "aangemeld", key: call.key, result };
    }
    let result: FinishResult;
    try {
      result = await timeout(
        withOneRetry(() => client.finishOriginal({ originalId: call.originalId })),
        CALL_TIMEOUT_MS,
      );
    } catch (e) {
      result = originalRefusal(e);
    }
    return { kind: "afgerond", key: call.key, result };
  }
}

const runner = new OriginalRunner();

/** Start de runner (de wortel van de app). */
export function startOriginals(): void {
  runner.start();
}

/** Wie er nu is ingelogd (Clerk en Convex), en de client voor de aanroepen. */
export function setOriginalsSession(client: OriginalsActions | null, userId: string | null): void {
  if (!originalUploaderAvailable) return;
  runner.setSession(client, userId);
}

export function nudgeOriginals(): void {
  if (!originalUploaderAvailable) return;
  runner.nudge();
}

/** 38b-3: een origineel bij "Toevoegen"; `false` als de wachtrij niet te laden was. */
export function addOriginalToQueue(input: {
  key: string;
  userId: string;
  projectId: string;
  fileName: string;
  bytes: number;
}): Promise<boolean> {
  if (!originalUploaderAvailable) return Promise.resolve(false);
  runner.start();
  return runner.add(input);
}

/** Het filmpje voor het album is klaar of mislukt (A-invariant 18), of het origineel is teruggetrokken. */
export function originalEvent(event: QueueEvent): void {
  if (!originalUploaderAvailable) return;
  runner.start();
  runner.dispatch(event);
}

/** 38b-4: Account verwijderen wist alles van die user op dit toestel. */
export async function forgetOriginalsOf(userId: string): Promise<void> {
  if (!originalUploaderAvailable) return;
  runner.start();
  await runner.forgetUser(userId);
}

/** "Alleen via wifi" (besluit 6): per toestel, geldt meteen. */
export function setOriginalsWifiOnly(on: boolean): Promise<boolean> {
  if (!originalUploaderAvailable) return Promise.resolve(false);
  runner.start();
  return runner.setWifiOnly(on);
}

export function listenOriginals(listener: () => void): () => void {
  return runner.listen(listener);
}

export function originalsSnapshot(): OriginalsSnapshot {
  return runner.snapshot();
}
