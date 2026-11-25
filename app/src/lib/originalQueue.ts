import {
  partFailure,
  partsToSend,
  waitsForWifi,
  type NetworkView,
  type PartToSend,
  type Refusal,
} from "./originalUpload";

// WP38b: de wachtrij van originelen op dit toestel, als pure functies. De
// runner (src/data/originals.ts) bewaart hem op schijf, past de effecten toe
// op de uploader en de bestanden, en doet de aanroepen die `nextCall` geeft.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus 38b,
// invarianten 38b-3 tot 38b-11.
//
// - Per filmpje één origineel (sleutel: de upload-id van het filmpje voor het
//   album, WP37), van één user. Aanroepen alleen voor de ingelogde user.
// - Stap `album`: wacht tot het filmpje in het album staat (A-invariant 18).
//   Dan `aanmelden` (op elk netwerk), `versturen` (de delen bij iOS; alleen
//   die wachten op wifi), `afronden` als iOS alle delen heeft verstuurd.
// - Aanroepen na elkaar, in een vaste volgorde: afronden, hervatten, nieuw;
//   binnen elke soort de oudste eerst (38b-7).
// - Opnieuw aanmelden na 403 of `NoSuchUpload`, na `missing`, na te veel
//   mislukte pogingen (later), of als de links bijna verlopen; niet bij een
//   herstart zolang de bewaarde links gelden (38b-5, 38b-6). Na RESUME_ROUNDS
//   aanmeldingen op rij zonder dat R2 minder delen mist: een dag wachten.
// - Weg (binnen, teruggetrokken, geweigerd, kapot): iOS vergeet het, het
//   bestand gaat weg en het origineel uit de wachtrij, dus nooit meer
//   aanmelden. Wachten of een fout: het bestand blijft (38b-9).
// - De wachtrij bewaart geen links: die staan alleen bij de uploader.
// Fix-cyclus 1:
// - Elke ronde links heeft een generatie; `aan_ios` geeft hem mee, de
//   uploader geeft hem terug in zijn events en taken. Een event of taak van
//   een andere generatie telt niet (punt 5).
// - De links gelden LINK_VALID_MS vanaf het moment dat het antwoord binnenkwam,
//   met de klok van het toestel; `expiresAt` van de server vergelijkt de app
//   niet met de eigen klok (punt 7).
// - Na een fout van een aanroep oplopend wachten: 1 minuut, tot een uur (punt 8).
// - Op schijf met een versie; een nieuwere versie zet er alleen velden bij
//   (punt 9).
// Fix-cyclus 2:
// - Komen er links binnen terwijl de stap al afronden is, dan blijven ze
//   liggen en volgt `finishOriginal` (punt 3).
// Fix-cyclus 3:
// - Geeft die hervatting iets anders dan links, dan ook geen wachttijd op het
//   afronden; alleen binnen of een definitieve weigering geldt (punt 4).
// Besluit red-team N6:
// - Elk origineel onthoudt wanneer de app zijn user voor het laatst ingelogd
//   zag (`seenAt`, nooit vroeger). Van een user die niet is ingelogd, gaan de
//   originelen na ABSENT_USER_MS weg (`dropAbsent`), zonder aanroep. Versie 2
//   op schijf; in versie 1 telt het moment van toevoegen.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const WAIT_MS = {
  fout: MINUTE,
  uitgelogd: 5 * MINUTE,
  te_vaak: HOUR,
  bezig: HOUR,
  later: HOUR,
  onbekend: HOUR,
  vol: DAY,
  vast: DAY,
};
/** Zoveel aanmeldingen op rij zonder dat R2 minder delen mist, dan een dag wachten. */
export const RESUME_ROUNDS = 3;
/** Gelden de links korter dan dit, dan eerst nieuwe links. */
export const LINK_MARGIN_MS = DAY;
/** Zo lang gelden de links van `startOriginal` (convex/lib/constants.ts, ORIGINAL_PART_LINK_SECONDS). */
const LINK_VALID_MS = 7 * DAY;
/** Na de zoveelste fout op rij wacht een aanroep nooit langer dan dit. */
const MAX_ERROR_WAIT_MS = HOUR;
/**
 * Besluit red-team N6: zo lang niet gezien, dan gaan de originelen van een
 * user die niet is ingelogd van het toestel.
 */
export const ABSENT_USER_MS = 30 * DAY;

export type QueueEntry = {
  key: string;
  userId: string;
  projectId: string;
  fileName: string;
  bytes: number;
  photoId: string | null;
  originalId: string | null;
  step: "album" | "aanmelden" | "versturen" | "afronden";
  addedAt: number;
  /**
   * Besluit red-team N6: het laatste moment dat de app deze user ingelogd zag
   * (in de klok van het toestel). Wordt nooit vroeger.
   */
  seenAt: number;
  /** Geen aanroep vóór dit moment (fout, te_vaak, vol, …). */
  waitUntil: number | null;
  /** `bezig`: een nieuwe aanmelding wacht tot een ander origineel van deze user weg is, hooguit tot hier. */
  busyUntil: number | null;
  /** Tot wanneer de links bij de uploader gelden, in de klok van het toestel (vanaf het antwoord). */
  linksValidUntil: number | null;
  /** De generatie van de laatste ronde links (0: nog geen). */
  generation: number;
  /** Fouten zonder reden op rij bij een aanroep (oplopend wachten). */
  errors: number;
  /** Aanmeldingen op rij zonder dat R2 minder delen mist. */
  rounds: number;
  /** Hoeveel delen R2 bij de vorige aanmelding miste. */
  lastMissing: number | null;
};

export type StartResult =
  | { kind: "upload"; originalId: string; partSize: number; parts: { partNumber: number; url: string }[]; expiresAt: number }
  | { kind: "done"; originalId: string }
  | Refusal;
export type FinishResult = { kind: "done" } | { kind: "missing"; parts: number[] } | Refusal;
export type QueueEvent =
  | { kind: "album_klaar"; key: string; photoId: string }
  | { kind: "album_mislukt"; key: string }
  | { kind: "aangemeld"; key: string; result: StartResult }
  | { kind: "afgerond"; key: string; result: FinishResult }
  | { kind: "delen_klaar"; originalId: string; generation: number }
  | {
      kind: "deel_mislukt";
      originalId: string;
      generation: number;
      partNumber: number;
      status: number | null;
      code: string | null;
      attempts: number;
    }
  | { kind: "teruggetrokken"; originalId: string }
  | { kind: "bestand_kapot"; key: string };
export type Effect =
  | { kind: "aan_ios"; originalId: string; fileName: string; generation: number; parts: PartToSend[] }
  | { kind: "ios_opnieuw"; originalId: string; partNumber: number }
  | { kind: "ios_vergeten"; originalId: string }
  | { kind: "bestand_weg"; fileName: string };
export type QueueStep = { queue: QueueEntry[]; effects: Effect[] };

export function addOriginal(
  queue: QueueEntry[],
  input: { key: string; userId: string; projectId: string; fileName: string; bytes: number },
  now: number,
): QueueEntry[] {
  if (queue.some((e) => e.key === input.key)) return queue;
  return [
    ...queue,
    {
      key: input.key,
      userId: input.userId,
      projectId: input.projectId,
      fileName: input.fileName,
      bytes: input.bytes,
      photoId: null,
      originalId: null,
      step: "album",
      addedAt: now,
      seenAt: now,
      waitUntil: null,
      busyUntil: null,
      linksValidUntil: null,
      generation: 0,
      errors: 0,
      rounds: 0,
      lastMissing: null,
    },
  ];
}

// --- hulpjes --------------------------------------------------------------------

const unchanged = (queue: QueueEntry[]): QueueStep => ({ queue, effects: [] });

function replace(queue: QueueEntry[], key: string, change: Partial<QueueEntry>): QueueEntry[] {
  return queue.map((e) => (e.key === key ? { ...e, ...change } : e));
}

/** Weg: iOS vergeet het, het bestand gaat weg; een `bezig` van dezelfde user hoeft niet meer te wachten. */
function removeEntry(queue: QueueEntry[], entry: QueueEntry): QueueStep {
  const effects: Effect[] = [];
  if (entry.originalId) effects.push({ kind: "ios_vergeten", originalId: entry.originalId });
  effects.push({ kind: "bestand_weg", fileName: entry.fileName });
  const rest = queue
    .filter((e) => e.key !== entry.key)
    .map((e) => (e.userId === entry.userId && e.busyUntil !== null ? { ...e, busyUntil: null } : e));
  return { queue: rest, effects };
}

/** Een wachttijd die er al is, wordt niet korter. */
const later = (current: number | null, until: number) => (current !== null && current > until ? current : until);

/**
 * Terug naar aanmelden (hervatten). Na RESUME_ROUNDS aanmeldingen op rij
 * zonder voortgang eerst een dag wachten (38b-6).
 */
function toResume(entry: QueueEntry, now: number, wait: number | null = null): Partial<QueueEntry> {
  let waitUntil = wait === null ? entry.waitUntil : later(entry.waitUntil, now + wait);
  if (entry.rounds >= RESUME_ROUNDS) waitUntil = later(waitUntil, now + WAIT_MS.vast);
  return { step: "aanmelden", waitUntil };
}

/** Een weigering die het origineel voorgoed weg doet. */
const FINAL = new Set(["niet_toegestaan", "te_groot", "te_klein", "geen_video"]);

/** Punt 8: 1 minuut na de eerste fout op rij, dan steeds het dubbele, nooit langer dan een uur. */
function errorWait(errorsBefore: number): number {
  return Math.min(MAX_ERROR_WAIT_MS, WAIT_MS.fout * 2 ** Math.min(errorsBefore, 20));
}

/** Een fout zonder reden bij een aanroep: oplopend wachten. */
function onError(queue: QueueEntry[], entry: QueueEntry, now: number, change: Partial<QueueEntry> = {}): QueueEntry[] {
  return replace(queue, entry.key, { ...change, waitUntil: now + errorWait(entry.errors), errors: entry.errors + 1 });
}

/**
 * Een weigering of fout die wachten betekent. `te_vaak` geldt voor alles van
 * die user; `bezig` alleen voor een nieuwe aanmelding.
 */
function applyWait(queue: QueueEntry[], entry: QueueEntry, refusal: Refusal, now: number): QueueEntry[] {
  if (refusal.kind === "fout") return onError(queue, entry, now);
  // Een andere uitkomst dan een fout: het oplopen begint weer bij 1 minuut.
  queue = replace(queue, entry.key, { errors: 0 });
  switch (refusal.reason) {
    case "te_vaak": {
      const until = now + WAIT_MS.te_vaak;
      return queue.map((e) => (e.userId === entry.userId ? { ...e, waitUntil: later(e.waitUntil, until) } : e));
    }
    case "bezig":
      return replace(queue, entry.key, { busyUntil: now + WAIT_MS.bezig });
    case "uitgelogd":
      return replace(queue, entry.key, { waitUntil: now + WAIT_MS.uitgelogd });
    case "vol":
      return replace(queue, entry.key, { waitUntil: now + WAIT_MS.vol });
    default:
      return replace(queue, entry.key, { waitUntil: now + WAIT_MS.onbekend });
  }
}

function onStart(queue: QueueEntry[], entry: QueueEntry, result: StartResult, now: number): QueueStep {
  if (result.kind === "done") return removeEntry(queue, { ...entry, originalId: result.originalId });
  if (result.kind === "geweigerd" && FINAL.has(result.reason)) return removeEntry(queue, entry);
  if (result.kind !== "upload") return unchanged(applyWait(queue, entry, result, now));

  const parts = partsToSend(entry.bytes, result.partSize, result.parts);
  if (parts === null) {
    // Ongeldige links: niets aan iOS, wachten zoals bij een fout.
    return unchanged(onError(queue, entry, now, { originalId: result.originalId }));
  }
  const missing = parts.length;
  const stalled = entry.lastMissing !== null && missing >= entry.lastMissing;
  // Punt 5: een eigen generatie per ronde, ook op hetzelfde moment; hoger dan
  // elke eerdere, ook als de uploader een ronde kreeg die de wachtrij op schijf
  // niet meer kent.
  const generation = Math.max(entry.generation + 1, now);
  const change: Partial<QueueEntry> = {
    originalId: result.originalId,
    // Punt 7: vanaf het antwoord, met de klok van het toestel.
    linksValidUntil: now + LINK_VALID_MS,
    generation,
    errors: 0,
    waitUntil: null,
    busyUntil: null,
    rounds: stalled ? entry.rounds + 1 : 1,
    lastMissing: missing,
  };
  if (parts.length === 0) {
    // Alles staat al in R2: meteen afronden.
    return unchanged(replace(queue, entry.key, { ...change, step: "afronden" }));
  }
  return {
    queue: replace(queue, entry.key, { ...change, step: "versturen" }),
    effects: [{ kind: "aan_ios", originalId: result.originalId, fileName: entry.fileName, generation, parts }],
  };
}

function onFinish(queue: QueueEntry[], entry: QueueEntry, result: FinishResult, now: number): QueueStep {
  if (result.kind === "done") return removeEntry(queue, entry);
  if (result.kind === "missing") return unchanged(replace(queue, entry.key, { ...toResume(entry, now), errors: 0 }));
  if (result.kind === "geweigerd" && FINAL.has(result.reason)) return removeEntry(queue, entry);
  return unchanged(applyWait(queue, entry, result, now));
}

/**
 * De uitkomst van een hervatting die liep terwijl de stap al afronden werd.
 * Fix-cyclus 2, punt 3: nieuwe links blijven liggen. Fix-cyclus 3, punt 4: ook
 * een wachttijd of een fout raakt het afronden niet (en telt niet mee voor het
 * oplopen); alleen wat het origineel voorgoed weg doet, geldt. `te_vaak` zet
 * hier ook geen wachttijd op de andere originelen van die user: een geweigerde
 * aanroep kost in de backend niets, en geeft het afronden zelf `te_vaak`, dan
 * wacht alles van die user alsnog een uur.
 */
function duringFinish(queue: QueueEntry[], entry: QueueEntry, result: StartResult): QueueStep {
  if (result.kind === "done") return removeEntry(queue, { ...entry, originalId: result.originalId });
  if (result.kind === "geweigerd" && FINAL.has(result.reason)) return removeEntry(queue, entry);
  return unchanged(queue);
}

export function applyEvent(queue: QueueEntry[], event: QueueEvent, now: number): QueueStep {
  switch (event.kind) {
    case "album_klaar": {
      const entry = queue.find((e) => e.key === event.key);
      if (!entry || entry.step !== "album") return unchanged(queue);
      return unchanged(replace(queue, entry.key, { photoId: event.photoId, step: "aanmelden" }));
    }
    case "album_mislukt": {
      const entry = queue.find((e) => e.key === event.key);
      if (!entry || entry.step !== "album") return unchanged(queue);
      return removeEntry(queue, entry);
    }
    case "aangemeld": {
      const entry = queue.find((e) => e.key === event.key);
      if (!entry || entry.step === "album" || entry.photoId === null) return unchanged(queue);
      // Fix-cyclus 2, punt 3: alle delen zijn al verstuurd terwijl de
      // hervatting liep. De nieuwe links blijven liggen: eerst afronden;
      // `missing` zegt wat er nog moet.
      if (entry.step === "afronden") return duringFinish(queue, entry, event.result);
      return onStart(queue, entry, event.result, now);
    }
    case "afgerond": {
      const entry = queue.find((e) => e.key === event.key);
      if (!entry || entry.step !== "afronden" || entry.originalId === null) return unchanged(queue);
      return onFinish(queue, entry, event.result, now);
    }
    case "delen_klaar": {
      const entry = queue.find((e) => e.originalId === event.originalId);
      // Punt 5: alleen de delen van de huidige links tellen.
      if (!entry || entry.step !== "versturen" || event.generation !== entry.generation) return unchanged(queue);
      return unchanged(replace(queue, entry.key, { step: "afronden" }));
    }
    case "deel_mislukt": {
      // Alleen zolang dit origineel verstuurt; daarna telt een late mislukking niet.
      const entry = queue.find((e) => e.originalId === event.originalId);
      if (!entry || entry.step !== "versturen" || event.generation !== entry.generation) return unchanged(queue);
      const action = partFailure(event);
      if (action === "opnieuw") {
        return { queue, effects: [{ kind: "ios_opnieuw", originalId: event.originalId, partNumber: event.partNumber }] };
      }
      const change = toResume(entry, now, action === "later" ? WAIT_MS.later : null);
      return unchanged(replace(queue, entry.key, change));
    }
    case "teruggetrokken": {
      const entry = queue.find((e) => e.originalId === event.originalId);
      return entry ? removeEntry(queue, entry) : unchanged(queue);
    }
    case "bestand_kapot": {
      const entry = queue.find((e) => e.key === event.key);
      return entry ? removeEntry(queue, entry) : unchanged(queue);
    }
  }
}

// --- de volgende aanroep -----------------------------------------------------------

export type NextCall =
  | { kind: "start"; key: string; photoId: string; bytes: number }
  | { kind: "finish"; key: string; originalId: string };

type Kind = "finish" | "resume" | "new";

const linksDueAt = (e: QueueEntry) => (e.linksValidUntil === null ? null : e.linksValidUntil - LINK_MARGIN_MS + 1);

/** Welke aanroep dit origineel wil, en vanaf wanneer; `null`: geen aanroep (album, of iOS verstuurt). */
function wants(e: QueueEntry): { kind: Kind; from: number } | null {
  const wait = e.waitUntil ?? 0;
  switch (e.step) {
    case "album":
      return null;
    case "afronden":
      return e.originalId === null ? null : { kind: "finish", from: wait };
    case "aanmelden":
      if (e.photoId === null) return null;
      if (e.originalId !== null) return { kind: "resume", from: wait };
      return { kind: "new", from: Math.max(wait, e.busyUntil ?? 0) };
    case "versturen": {
      // De links gelden nog minder dan LINK_MARGIN_MS: eerst nieuwe, ook als de delen op wifi wachten.
      const due = linksDueAt(e);
      if (due === null || e.photoId === null) return null;
      return { kind: "resume", from: Math.max(wait, due) };
    }
  }
}

const ORDER: Record<Kind, number> = { finish: 0, resume: 1, new: 2 };

export function nextCall(queue: readonly QueueEntry[], ctx: { now: number; userId: string | null }): NextCall | null {
  if (ctx.userId === null) return null;
  let best: { entry: QueueEntry; kind: Kind } | null = null;
  for (const entry of queue) {
    if (entry.userId !== ctx.userId) continue;
    const want = wants(entry);
    if (!want || want.from > ctx.now) continue;
    if (
      !best ||
      ORDER[want.kind] < ORDER[best.kind] ||
      (ORDER[want.kind] === ORDER[best.kind] && entry.addedAt < best.entry.addedAt)
    ) {
      best = { entry, kind: want.kind };
    }
  }
  if (!best) return null;
  const { entry, kind } = best;
  if (kind === "finish") return { kind: "finish", key: entry.key, originalId: entry.originalId! };
  return { kind: "start", key: entry.key, photoId: entry.photoId!, bytes: entry.bytes };
}

/** Het vroegste moment na `now` waarop iets dat nu wacht weer mag; `null` als er niets wacht. */
export function nextWake(queue: readonly QueueEntry[], ctx: { now: number; userId: string | null }): number | null {
  if (ctx.userId === null) return null;
  let wake: number | null = null;
  for (const entry of queue) {
    if (entry.userId !== ctx.userId) continue;
    const want = wants(entry);
    if (!want || want.from <= ctx.now) continue;
    if (wake === null || want.from < wake) wake = want.from;
  }
  return wake;
}

// --- bij de start van de app ----------------------------------------------------------

export type NativeJobView = {
  originalId: string;
  /** De generatie van de links van deze taak (punt 5). */
  generation: number;
  parts: {
    partNumber: number;
    state: "wacht" | "bezig" | "klaar" | "mislukt";
    status: number | null;
    code: string | null;
    attempts: number;
  }[];
};

/**
 * 38b-5: de wachtrij naast wat de uploader nog heeft. Wat iOS nog heeft, loopt
 * door; alles klaar: afronden; de uploader weet niets meer: opnieuw aanmelden;
 * een origineel dat nog op zijn album wachtte: weg (die ronde bestaat niet
 * meer). Taken en bestanden zonder origineel in de wachtrij (van welke user
 * ook) gaan weg.
 */
export function atLaunch(
  queue: QueueEntry[],
  native: { jobs: readonly NativeJobView[]; files: readonly string[] },
  now: number,
): QueueStep {
  let q = queue;
  const effects: Effect[] = [];

  for (const entry of queue.filter((e) => e.step === "album")) {
    const r = removeEntry(q, entry);
    q = r.queue;
    effects.push(...r.effects);
  }

  for (const entry of q.filter((e) => e.step === "versturen" && e.originalId !== null)) {
    const job = native.jobs.find((j) => j.originalId === entry.originalId);
    // Punt 5: heeft de uploader alleen een andere ronde links (de app viel weg
    // tussen het bewaren van de wachtrij en het doorgeven), dan weet hij niets.
    if (!job || job.generation !== entry.generation) {
      q = replace(q, entry.key, { step: "aanmelden" });
      continue;
    }
    if (job.parts.length > 0 && job.parts.every((p) => p.state === "klaar")) {
      q = replace(q, entry.key, { step: "afronden" });
      continue;
    }
    const failed = job.parts.filter((p) => p.state === "mislukt");
    const actions = failed.map((p) => ({ part: p, action: partFailure(p) }));
    if (actions.some((a) => a.action === "opnieuw_aanmelden")) {
      q = replace(q, entry.key, toResume(entry, now));
    } else if (actions.some((a) => a.action === "later")) {
      q = replace(q, entry.key, toResume(entry, now, WAIT_MS.later));
    } else {
      for (const a of actions) effects.push({ kind: "ios_opnieuw", originalId: job.originalId, partNumber: a.part.partNumber });
    }
  }

  const ids = new Set(q.map((e) => e.originalId).filter((id): id is string => id !== null));
  for (const job of native.jobs) {
    if (!ids.has(job.originalId)) effects.push({ kind: "ios_vergeten", originalId: job.originalId });
  }
  const files = new Set(q.map((e) => e.fileName));
  const gone = new Set(effects.flatMap((e) => (e.kind === "bestand_weg" ? [e.fileName] : [])));
  for (const file of native.files) {
    if (!files.has(file) && !gone.has(file)) {
      gone.add(file);
      effects.push({ kind: "bestand_weg", fileName: file });
    }
  }
  return { queue: q, effects };
}

/** Account verwijderd op dit toestel: alles van die user weg, met bestanden en iOS-taken. */
export function forgetUser(queue: QueueEntry[], userId: string): QueueStep {
  const effects: Effect[] = [];
  for (const entry of queue) {
    if (entry.userId !== userId) continue;
    if (entry.originalId) effects.push({ kind: "ios_vergeten", originalId: entry.originalId });
    effects.push({ kind: "bestand_weg", fileName: entry.fileName });
  }
  return { queue: queue.filter((e) => e.userId !== userId), effects };
}

/** De app ziet deze user ingelogd: het moment gaat naar `now`, maar nooit vroeger. */
export function seenUser(queue: QueueEntry[], userId: string, now: number): QueueEntry[] {
  if (!queue.some((e) => e.userId === userId && e.seenAt < now)) return queue;
  return queue.map((e) => (e.userId === userId && e.seenAt < now ? { ...e, seenAt: now } : e));
}

/**
 * Besluit red-team N6: de originelen van elke user behalve `ctx.userId` die
 * ABSENT_USER_MS of langer niet gezien is, gaan weg, met bestand en iOS-taken.
 * Zonder login niets (38b-8). Een klok die achter staat, wist niets.
 */
export function dropAbsent(queue: QueueEntry[], ctx: { now: number; userId: string | null }): QueueStep {
  if (ctx.userId === null) return unchanged(queue);
  let step = unchanged(queue);
  for (const entry of queue) {
    if (entry.userId === ctx.userId || ctx.now - entry.seenAt < ABSENT_USER_MS) continue;
    const next = removeEntry(step.queue, entry);
    step = { queue: next.queue, effects: [...step.effects, ...next.effects] };
  }
  return step;
}

// --- de stand van een eigen origineel (38c toont hem) ----------------------------------

export type OwnStand = "binnen" | "wordt_verstuurd" | "wacht_op_wifi" | "wacht" | "elders";

export function ownOriginalStand(input: {
  status: "onderweg" | "binnen";
  originalId: string;
  queue: readonly QueueEntry[];
  wifiOnly: boolean;
  network: NetworkView;
  now: number;
}): OwnStand {
  if (input.status === "binnen") return "binnen";
  const entry = input.queue.find((e) => e.originalId === input.originalId);
  if (!entry) return "elders";
  if (entry.step === "versturen") {
    // De delen zijn bij iOS; alleen die wachten op wifi.
    return waitsForWifi(input.wifiOnly, input.network) ? "wacht_op_wifi" : "wordt_verstuurd";
  }
  // Aanmelden en afronden gaan op elk netwerk; alleen een wachttijd houdt ze op.
  const want = wants(entry);
  return want && want.from > input.now ? "wacht" : "wordt_verstuurd";
}

// --- op schijf (punt 9) ------------------------------------------------------------------

/**
 * De versie van de wachtrij op schijf. Een nieuwere versie zet er alleen
 * velden bij; deze app leest wat hij kent en laat de rest weg.
 */
const QUEUE_STORE_VERSION = 2;

const STEPS: readonly QueueEntry["step"][] = ["album", "aanmelden", "versturen", "afronden"];

/** Alleen de velden die deze versie kent, of `null` als het geen bekend origineel is. */
function entryFromStore(v: unknown): QueueEntry | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  const str = (k: string): string | null => (typeof e[k] === "string" && e[k] !== "" ? (e[k] as string) : null);
  const strOrNull = (k: string): string | null | undefined =>
    e[k] === null ? null : typeof e[k] === "string" ? (e[k] as string) : undefined;
  const num = (k: string): number | null => (typeof e[k] === "number" && Number.isFinite(e[k]) ? (e[k] as number) : null);
  const numOrNull = (k: string): number | null | undefined => (e[k] === null ? null : (num(k) ?? undefined));

  const key = str("key");
  const userId = str("userId");
  const projectId = str("projectId");
  const fileName = str("fileName");
  const bytes = num("bytes");
  const photoId = strOrNull("photoId");
  const originalId = strOrNull("originalId");
  const step = STEPS.find((s) => s === e.step);
  const addedAt = num("addedAt");
  // Versie 1 kende `seenAt` niet: dan telt het moment van toevoegen (besluit red-team N6).
  const seenAt = e.seenAt === undefined ? addedAt : num("seenAt");
  const waitUntil = numOrNull("waitUntil");
  const busyUntil = numOrNull("busyUntil");
  const linksValidUntil = numOrNull("linksValidUntil");
  const generation = num("generation");
  const errors = num("errors");
  const rounds = num("rounds");
  const lastMissing = numOrNull("lastMissing");
  if (
    key === null ||
    userId === null ||
    projectId === null ||
    fileName === null ||
    bytes === null ||
    photoId === undefined ||
    originalId === undefined ||
    step === undefined ||
    addedAt === null ||
    seenAt === null ||
    waitUntil === undefined ||
    busyUntil === undefined ||
    linksValidUntil === undefined ||
    generation === null ||
    errors === null ||
    rounds === null ||
    lastMissing === undefined
  ) {
    return null;
  }
  return {
    key,
    userId,
    projectId,
    fileName,
    bytes,
    photoId,
    originalId,
    step,
    addedAt,
    seenAt,
    waitUntil,
    busyUntil,
    linksValidUntil,
    generation,
    errors,
    rounds,
    lastMissing,
  };
}

export function queueToStore(queue: readonly QueueEntry[]): string {
  return JSON.stringify({ version: QUEUE_STORE_VERSION, queue });
}

/**
 * `null`: niets bewaard (leeg, niet kapot). Wat geen wachtrij van een bekende
 * vorm is: leeg en kapot. Een origineel dat deze app niet kan lezen, valt weg
 * en maakt de wachtrij kapot; de rest blijft.
 */
export function queueFromStore(raw: string | null): { queue: QueueEntry[]; broken: boolean } {
  if (raw === null) return { queue: [], broken: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { queue: [], broken: true };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { queue: [], broken: true };
  const stored = parsed as { version?: unknown; queue?: unknown };
  if (typeof stored.version !== "number" || !Number.isInteger(stored.version) || stored.version < 1) {
    return { queue: [], broken: true };
  }
  if (!Array.isArray(stored.queue)) return { queue: [], broken: true };
  const queue: QueueEntry[] = [];
  let broken = false;
  for (const item of stored.queue) {
    const entry = entryFromStore(item);
    if (entry === null || queue.some((e) => e.key === entry.key)) broken = true;
    else queue.push(entry);
  }
  return { queue, broken };
}
