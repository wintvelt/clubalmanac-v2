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
  uploaderWifiOnly,
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
  dropAbsent,
  forgetUser,
  nextCall,
  nextWake,
  queueFromStore,
  queueToStore,
  seenUser,
  type Effect,
  type FinishResult,
  type NextCall,
  type QueueEntry,
  type QueueEvent,
  type QueueStep,
  type StartResult,
} from "../lib/originalQueue";
import { originalRefusal, wifiOnlyAtStart, wifiOnlyToStore, type NetworkView } from "../lib/originalUpload";

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
//   Fix-cyclus 1, punt 2: geen eigen time-out. De Convex-client houdt een
//   action vast tot hij weer verbinding heeft; een nieuwe aanroep gaat pas als
//   de vorige een uitkomst heeft (antwoord of fout van de client). Een laat
//   antwoord telt nog.
//   Fix-cyclus 2, punt 2: was er tijdens de aanroep een andere user ingelogd
//   (ook als de eerste al terug is), dan telt de uitkomst als fout.
// - Uitloggen pauzeert alleen; Account verwijderen wist alles van die user.
//   Laadt de wachtrij nog niet, dan wacht Account verwijderen niet: de runner
//   onthoudt de user en wist hem zodra het laden lukt (punt 4).
// - Het laden wist niets wat in dit proces is aangemaakt: een bestand dat het
//   toevoegscherm verplaatste terwijl het laden liep, telt niet als wees
//   (punt 3).
// - "Alleen via wifi" bij twijfel aan (punt 6): bij de start de eigen waarde
//   naast die van de uploader; uitzetten geldt pas als bewaren en omzetten
//   allebei lukken. Het omzetten loopt los van de rij, zodat het niet wacht op
//   het snijden of een aanroep (punt 10).
//   Fix-cyclus 3, punt 3: bij het laden eerst `uploaderJobs`, dan de stand.
//   Een leesfout (van de app of de uploader) geeft aan voor nu, zonder iets te
//   bewaren, zodat een wekking op slot hem niet blijvend aanzet.
// - De wachtrij op schijf heeft een versie (queueToStore); een onleesbare
//   wachtrij geeft een regel in het log (punt 9).
// - Besluit red-team N6: de runner ziet een user bij inloggen, bij het
//   laden, bij terugkomst (`nudge`), bij toevoegen, en bij uitloggen of een
//   wissel (de vorige user). Na het laden en bij elke login gaan de
//   originelen weg van een andere user die 30 dagen niet gezien is
//   (`dropAbsent`), zonder aanroep. Zonder login gaat niets weg.
// - Geen link, sleutel of pad in het log: alleen inzending-id, deelnummer,
//   status en reden (38b-16).

const QUEUE_FILE = "queue.json";
const WIFI_FILE = "wifi-only.txt";
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
  /** Het omzetten van "Alleen via wifi" na elkaar, los van de rij (punt 10). */
  private wifiChain: Promise<void> = Promise.resolve();
  /** Bestanden die dit proces in de map zette: het laden wist ze niet (punt 3). */
  private ownFiles = new Set<string>();
  /** Account verwijderd terwijl de wachtrij niet laadde: wissen zodra het laden lukt (punt 4). */
  private forgetAfterLoad = new Set<string>();
  /**
   * Besluit red-team N6: per user het laatste moment dat de app hem ingelogd
   * zag en dat nog niet in de wachtrij staat (die laadt misschien nog niet).
   */
  private seenPending = new Map<string, number>();
  private network: NetworkView = { type: "onbekend", expensive: false };
  private chain: Promise<void> = Promise.resolve();
  private client: OriginalsActions | null = null;
  private userId: string | null = null;
  private calling = false;
  /**
   * Punt 2 (fix-cyclus 2): de user van de aanroep die loopt, en of er tijdens
   * die aanroep een andere user ingelogd was.
   */
  private callUser: string | null = null;
  private callSwitched = false;
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
          generation: typeof e.generation === "number" ? e.generation : -1,
          partNumber: e.partNumber,
          status: typeof e.status === "number" ? e.status : null,
          code: typeof e.code === "string" ? e.code : null,
          attempts: typeof e.attempts === "number" ? e.attempts : 1,
        }),
      allPartsDone: (e) =>
        this.dispatch({
          kind: "delen_klaar",
          originalId: e.originalId,
          generation: typeof e.generation === "number" ? e.generation : -1,
        }),
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
    // Punt 2: een andere user tijdens een aanroep (uitloggen telt niet).
    if (this.calling && userId !== null && userId !== this.callUser) this.callSwitched = true;
    // Besluit red-team N6: de vorige user (uitloggen of een wissel) en de nieuwe zijn nu gezien.
    const now = Date.now();
    if (this.userId !== null) this.markSeen(this.userId, now);
    if (userId !== null) this.markSeen(userId, now);
    this.client = client;
    this.userId = userId;
    this.changed();
    if (!this.started) return;
    // Bij elke login: de originelen van een andere user die 30 dagen niet gezien is.
    void this.run(async () => {
      await this.flushSeen();
      if (userId !== null) await this.dropAbsentUsers();
    });
  }

  /** De app is weer actief, of iets anders kan nu misschien verder. */
  nudge(): void {
    if (!this.started) return;
    // Besluit red-team N6: terugkomst in de app telt als gezien.
    if (this.userId !== null) this.markSeen(this.userId, Date.now());
    if (!this.loaded || this.seenPending.size > 0) {
      void this.run(() => this.flushSeen());
      return;
    }
    void this.pump();
  }

  /** Is de wachtrij geladen (of lukt het laden nu)? Het toevoegscherm wacht hierop voordat het de kopie verplaatst. */
  ready(): Promise<boolean> {
    return this.run(async () => {});
  }

  /**
   * 38b-3: het origineel bij "Toevoegen", met als stap: wacht op het album.
   * `false`: niet aangenomen (de wachtrij laadt niet, of dat filmpje staat er
   * al met een ander bestand).
   */
  async add(input: { key: string; userId: string; projectId: string; fileName: string; bytes: number }): Promise<boolean> {
    this.ownFiles.add(input.fileName);
    let taken = false;
    const loaded = await this.run(async () => {
      const now = Date.now();
      this.queue = seenUser(addOriginal(this.queue, input, now), input.userId, now);
      taken = this.queue.some((e) => e.key === input.key && e.fileName === input.fileName);
      if (!taken) return;
      await this.save();
      this.note(`origineel in de wachtrij (${Math.round(input.bytes / 1048576)} MiB)`);
    });
    return loaded && taken;
  }

  dispatch(event: QueueEvent): void {
    void this.run(() => this.apply(event));
  }

  /**
   * Account verwijderd op dit toestel: alles van die user weg (38b-4). Laadt
   * de wachtrij (nog) niet, dan wacht dit niet: de runner onthoudt de user en
   * wist hem zodra het laden lukt (punt 4; alleen zolang de app draait).
   */
  async forgetUser(userId: string): Promise<void> {
    if (!this.loaded) {
      this.forgetAfterLoad.add(userId);
      void this.run(async () => {});
      return;
    }
    await this.run(async () => {
      await this.commit(forgetUser(this.queue, userId));
    });
  }

  /**
   * "Alleen via wifi" (punt 6): aanzetten geldt meteen, ook als bewaren niet
   * lukt. Uitzetten geldt pas als het bewaren en het omzetten bij de uploader
   * allebei lukken; anders blijft hij aan, in de app en bij de uploader.
   */
  setWifiOnly(on: boolean): Promise<boolean> {
    return this.wifiRun(async () => {
      if (on) {
        this.setWifiState(true);
        try {
          await writeOriginalState(WIFI_FILE, wifiOnlyToStore(true));
        } catch {
          this.note("alleen via wifi: bewaren lukte niet, de stand is aan");
        }
        try {
          await uploaderSetWifiOnly(true);
        } catch {
          this.note("alleen via wifi: omzetten bij de uploader lukte niet");
        }
        return true;
      }
      try {
        await writeOriginalState(WIFI_FILE, wifiOnlyToStore(false));
      } catch {
        this.note("alleen via wifi: bewaren lukte niet, de stand blijft aan");
        this.setWifiState(true);
        return false;
      }
      try {
        await uploaderSetWifiOnly(false);
      } catch {
        this.note("alleen via wifi: omzetten bij de uploader lukte niet, de stand blijft aan");
        try {
          await writeOriginalState(WIFI_FILE, wifiOnlyToStore(true));
        } catch {
          // Bij de start telt dan de uploader mee: die staat nog aan.
        }
        this.setWifiState(true);
        return false;
      }
      this.setWifiState(false);
      return true;
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

  private setWifiState(on: boolean): void {
    if (this.wifiOnly === on) return;
    this.wifiOnly = on;
    this.changed();
  }

  /** Na elkaar, los van de rij met de wachtrij. */
  private wifiRun(work: () => Promise<boolean>): Promise<boolean> {
    const next = this.wifiChain.then(work).catch(() => false);
    this.wifiChain = next.then(() => undefined);
    return next;
  }

  /**
   * Punt 6: bij de start de eigen waarde naast die van de uploader; alleen als
   * beide uit zeggen, is het uit. Zeggen ze allebei iets en is het aan, dan
   * ook aan bij de uploader en op schijf.
   * Fix-cyclus 3, punt 3: kan de app zijn eigen waarde niet lezen (een
   * leesfout, geen onleesbare waarde) of de uploader zijn stand niet geven,
   * dan aan voor nu, maar niets bewaard: niet in de app, niet bij de uploader.
   * Bij het volgende laden telt weer wat er bewaard is.
   */
  private loadWifi(): Promise<boolean> {
    return this.wifiRun(async () => {
      let stored: string | null = null;
      let doubt = false;
      try {
        stored = await readOriginalState(WIFI_FILE);
      } catch {
        doubt = true;
        this.note("alleen via wifi: de eigen waarde was niet te lezen, aan voor nu");
      }
      let native: boolean | null = null;
      try {
        native = await uploaderWifiOnly();
      } catch {
        doubt = true;
        this.note("alleen via wifi: de uploader kon zijn stand niet geven, aan voor nu");
      }
      const on = doubt || wifiOnlyAtStart(stored, native);
      this.setWifiState(on);
      if (!on || doubt) return true;
      if (stored !== wifiOnlyToStore(true)) {
        try {
          await writeOriginalState(WIFI_FILE, wifiOnlyToStore(true));
        } catch {
          // De uploader staat aan; bij de volgende start telt die mee.
        }
      }
      if (native !== true) {
        try {
          await uploaderSetWifiOnly(true);
        } catch {
          this.note("alleen via wifi: aanzetten bij de uploader lukte niet");
        }
      }
      return true;
    });
  }

  /** Besluit red-team N6: onthoud dat de app deze user nu ingelogd zag (nooit vroeger). */
  private markSeen(userId: string, now: number): void {
    const before = this.seenPending.get(userId);
    if (before === undefined || before < now) this.seenPending.set(userId, now);
  }

  /** Zet de onthouden momenten in de wachtrij (alleen na het laden). */
  private async flushSeen(): Promise<void> {
    if (!this.loaded || this.seenPending.size === 0) return;
    const before = this.queue;
    let queue = this.queue;
    for (const [userId, at] of this.seenPending) queue = seenUser(queue, userId, at);
    this.seenPending.clear();
    if (queue === before) return;
    await this.commit({ queue, effects: [] });
  }

  /**
   * Besluit red-team N6: de originelen van een andere user dan wie nu is
   * ingelogd, die 30 dagen niet gezien is. Niemand ingelogd: niets.
   */
  private async dropAbsentUsers(): Promise<void> {
    const userId = this.userId;
    if (!this.loaded || userId === null) return;
    const step = dropAbsent(this.queue, { now: Date.now(), userId });
    if (step.queue.length === this.queue.length) return;
    this.note(`${this.queue.length - step.queue.length} originelen van een user die 30 dagen niet ingelogd was: weg`);
    await this.commit(step);
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
    try {
      raw = await readOriginalState(QUEUE_FILE);
    } catch {
      // Nog op slot of een andere leesfout: niets overschrijven, later opnieuw.
      this.schedule(Date.now() + LOAD_RETRY_MS);
      return false;
    }
    const stored = queueFromStore(raw);
    if (stored.broken) this.note("wachtrij onleesbaar: wat te lezen was blijft, de rest gaat weg");
    let jobs: Awaited<ReturnType<typeof uploaderJobs>>;
    let files: string[];
    try {
      jobs = await uploaderJobs();
      files = await listOriginals();
    } catch {
      // De uploader kon zijn opslag nog niet lezen: niets aan de stand
      // veranderen, later opnieuw (fix-cyclus 3, punt 3).
      this.schedule(Date.now() + LOAD_RETRY_MS);
      return false;
    }
    // Pas als de uploader zijn taken gaf, zijn stand (fix-cyclus 3, punt 3).
    await this.loadWifi();
    this.loaded = true;
    // Punt 3: wat dit proces al in de map zette (het toevoegscherm, terwijl
    // het laden liep), is geen wees.
    const known = files.filter((f) => !this.ownFiles.has(f));
    const step = atLaunch(stored.queue, { jobs, files: known }, Date.now());
    await this.commit(step);
    // Punt 4: Account verwijderd terwijl het laden nog niet lukte.
    for (const userId of [...this.forgetAfterLoad]) {
      this.forgetAfterLoad.delete(userId);
      await this.commit(forgetUser(this.queue, userId));
      this.note("account verwijderd: alles van die user weg");
    }
    // Een kapot bestand dat de uploader al zag terwijl de app er niet was.
    for (const job of jobs) {
      if (!job.broken) continue;
      const entry = this.queue.find((e) => e.originalId === job.originalId);
      if (entry) await this.commit(applyEvent(this.queue, { kind: "bestand_kapot", key: entry.key }, Date.now()));
    }
    // Besluit red-team N6: wie nu is ingelogd, is gezien; daarna de users die 30 dagen weg zijn.
    if (this.userId !== null) this.markSeen(this.userId, Date.now());
    await this.flushSeen();
    await this.dropAbsentUsers();
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
      await writeOriginalState(QUEUE_FILE, queueToStore(this.queue));
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
              generation: effect.generation,
              totalBytes: entry.bytes,
              partSize: links.partSize,
              expiresAt: entry.linksValidUntil ?? links.expiresAt,
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
    this.callUser = userId;
    this.callSwitched = false;
    try {
      const failed: QueueEvent =
        call.kind === "start"
          ? { kind: "aangemeld", key: call.key, result: { kind: "fout" } }
          : { kind: "afgerond", key: call.key, result: { kind: "fout" } };
      let event: QueueEvent;
      try {
        event = await withBackgroundWork(() => this.perform(client, call));
      } catch {
        event = failed;
      }
      // Punt 2: was er tussendoor een andere user ingelogd, dan kan de
      // Convex-client de action met diens login hebben verstuurd. De uitkomst
      // zegt dan niets over dit origineel: een fout, niets weg.
      if (this.callSwitched) {
        this.note(`${call.kind === "start" ? "startOriginal" : "finishOriginal"}: andere user tussendoor, telt als fout`);
        event = failed;
      }
      // Pas na het verwerken van de uitkomst de volgende aanroep (38b-7: één tegelijk).
      await this.run(() => this.apply(event));
    } finally {
      this.calling = false;
      this.callUser = null;
      this.callSwitched = false;
    }
    void this.pump();
  }

  private async perform(client: OriginalsActions, call: NextCall): Promise<QueueEvent> {
    if (call.kind === "start") {
      let result: StartResult;
      try {
        result = await withOneRetry(() => client.startOriginal({ photoId: call.photoId as Id<"photos">, bytes: call.bytes }));
      } catch (e) {
        result = originalRefusal(e);
      }
      return { kind: "aangemeld", key: call.key, result };
    }
    let result: FinishResult;
    try {
      result = await withOneRetry(() => client.finishOriginal({ originalId: call.originalId }));
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

/**
 * Punt 3: is de wachtrij geladen? Het toevoegscherm verplaatst de kopie pas
 * daarna; `false`: niet te laden (dan gaat het filmpje zonder origineel).
 */
export function originalsReady(): Promise<boolean> {
  if (!originalUploaderAvailable) return Promise.resolve(false);
  runner.start();
  return runner.ready();
}

/** 38b-3: een origineel bij "Toevoegen"; `false` als de wachtrij het niet aannam. */
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
