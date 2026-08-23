// WP12 — `transform`: DynamoDB-items → Convex-vormige records.
//
// Zie docs/work-packages/WP12-data-migratie-tooling.md. Deze module is bewust
// een **pure functie**: extract-items in, records + waarschuwingen uit, zonder
// AWS- of Convex-verbinding. Alles wat semantisch fout kan gaan zit hier, en
// alleen hier is het te unit-testen (tests/migration/transform.test.ts).
//
// De zes semantische valkuilen uit de spec-criticus-pass, en waar ze landen:
//   1. `createdAt` is een kalenderdag → `toEpoch()`, UTC-middernacht.
//   2. `seenPics` is een ONGELEZEN-wachtrij → `deriveAlbumLastSeen()`.
//   3. `featureUpvotes` heeft geen bron → upvoteCount 0 + verlies-waarschuwing.
//   4. rollen/statussen/types matchen niet → `mapRole()` / `mapFeatureStatus()`,
//      en ratings zijn likes (0/1), geen 1..5-score.
//   5. verplichte velden zonder bron → founder-afleiding, gesynthetiseerde
//      `albums.createdBy`, `albumPhotos.addedBy` = eigenaar van de foto.
//   6. lege string is een "leeg"-sentinel → `str()` behandelt '' als afwezig.
//
// Anonimisatie zit *in* de transform (dev-config), niet als opruimactie erna:
// echte namen en adressen verlaten deze stap niet. Dat geldt ook voor de
// bron-sleutel van een invite (die ís een emailadres) en voor de invite-token
// (base64 van diezelfde sleutel).

import {
  emptyRecords,
  FKS,
  type Records,
  type Row,
  type SourceItem,
  type TransformResult,
} from "./types.ts";

export type TransformConfig = {
  target: "dev" | "prod";
  /** `null` = geen filter (prod). Dev eist een niet-lege lijst. */
  chosenUserIds: string[] | null;
  anonymize: boolean;
  /** `U{sub}` → Clerk-ID. Prod-map wordt in config.ts uit email→Clerk herleid. */
  subjectByUserId: Record<string, string>;
  defaultPhotoLimit: number;
  /** Referentie-"nu" voor invite-expiry. Expliciet zodat de run reproduceerbaar is. */
  now: number;
  /** Ontsnapping voor een groep zonder founder-membership: groupId → userId. */
  founderOverrides?: Record<string, string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 30 * DAY_MS;

// Herkenbare dev-namen (migratie-plan §Dev seed strategie). Voorbij de lijst
// telt de generator door; anonimiseren mag nooit op een naam-collisie stuklopen.
const DEV_NAMES = ["Dev Wouter", "Dev Anna", "Dev Bram", "Dev Chris", "Dev Dana"];

// Domein van alle vervangende adressen. Wat hierop eindigt is al geanonimiseerd
// en mag niet nog een keer door de scrub.
const ANON_DOMAIN = "clubalmanac.test";

// Emailadres in vrije tekst. Ruim genomen: liever één te veel gemaskeerd dan
// één bron-adres dat in een waarschuwing blijft staan.
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// ── kleine helpers ────────────────────────────────────────────────────

/** Lege string = afwezig (correctie 6), niet "lege waarde". */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Kalenderdag → epoch-ms op UTC-middernacht (correctie 1). Deterministisch en
 * omkeerbaar; géén verzonnen spreiding binnen de dag om ties te breken.
 */
function toEpoch(value: unknown): number | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T00:00:00.000Z`);
    return Number.isNaN(t) ? undefined : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

function normalizeEmail(value: unknown): string | undefined {
  const s = str(value);
  return s === undefined ? undefined : s.toLowerCase();
}

/** Stabiele, korte hash (FNV-1a, twee seeds) — voor invite-tokens. */
function stableHash(input: string): string {
  const round = (seed: number): string => {
    let h = seed;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return round(0x811c9dc5) + round(0x9e3779b1);
}

function fail(message: string): never {
  throw new Error(`[transform] ${message}`);
}

// ── bron-classificatie ────────────────────────────────────────────────

type UserSource = {
  userId: string;
  base: SourceItem;
  visit?: SourceItem;
};

type MembershipSource = {
  /** `U{sub}` of een emailadres (invite aan iemand zonder account). */
  inviteeKey: string;
  groupId: string;
  item: SourceItem;
};

type Parsed = {
  users: Map<string, UserSource>;
  groups: Map<string, SourceItem>;
  memberships: MembershipSource[];
  albums: Map<string, { groupId: string; item: SourceItem }>;
  albumPhotos: Array<{ groupId: string; albumId: string; photoId: string; item: SourceItem }>;
  photos: Map<string, { ownerId: string; item: SourceItem }>;
  ratings: Array<{ photoId: string; userId: string; item: SourceItem }>;
  features: Map<string, SourceItem>;
  unknown: Map<string, number>;
};

function parse(items: SourceItem[]): Parsed {
  const parsed: Parsed = {
    users: new Map(),
    groups: new Map(),
    memberships: [],
    albums: new Map(),
    albumPhotos: [],
    photos: new Map(),
    ratings: [],
    features: new Map(),
    unknown: new Map(),
  };

  const upsertUser = (userId: string): UserSource => {
    const existing = parsed.users.get(userId);
    if (existing) return existing;
    const created: UserSource = { userId, base: {} };
    parsed.users.set(userId, created);
    return created;
  };

  for (const item of items) {
    const pk = str(item.PK);
    const sk = str(item.SK);
    if (pk === undefined || sk === undefined) {
      parsed.unknown.set("(zonder PK/SK)", (parsed.unknown.get("(zonder PK/SK)") ?? 0) + 1);
      continue;
    }

    // Exacte PK's eerst: UBbase/UPstats/UVvisit/USER beginnen allemaal met "U",
    // net als de UM-/UF-prefixen.
    if (pk === "UBbase") {
      upsertUser(sk).base = item;
      continue;
    }
    if (pk === "UVvisit") {
      upsertUser(sk).visit = item;
      continue;
    }
    if (pk === "UPstats") {
      // photoCount wordt herteld uit de PO-records (correctie 5) — dit record
      // draagt bekende drift en is dus geen bron.
      continue;
    }
    if (pk === "USER") {
      // Afgeleide merge-kopie, geschreven door de stream. Géén bron.
      continue;
    }
    if (pk === "GBbase") {
      parsed.groups.set(sk, item);
      continue;
    }
    if (pk === "NFfeature") {
      parsed.features.set(sk, item);
      continue;
    }
    if (pk.startsWith("UM")) {
      parsed.memberships.push({ inviteeKey: pk.slice(2), groupId: sk, item });
      continue;
    }
    if (pk.startsWith("UF")) {
      parsed.ratings.push({ photoId: pk.slice(2), userId: sk, item });
      continue;
    }
    if (pk.startsWith("GA")) {
      parsed.albums.set(sk, { groupId: pk.slice(2), item });
      continue;
    }
    if (pk.startsWith("GP")) {
      const rest = pk.slice(2);
      const hash = rest.indexOf("#");
      if (hash < 0) {
        parsed.unknown.set(pk, (parsed.unknown.get(pk) ?? 0) + 1);
        continue;
      }
      parsed.albumPhotos.push({
        groupId: rest.slice(0, hash),
        albumId: rest.slice(hash + 1),
        photoId: sk,
        item,
      });
      continue;
    }
    if (pk.startsWith("PO")) {
      parsed.photos.set(pk.slice(2), { ownerId: sk, item });
      continue;
    }
    const prefix = pk.slice(0, 2);
    parsed.unknown.set(prefix, (parsed.unknown.get(prefix) ?? 0) + 1);
  }

  return parsed;
}

// ── waarde-mappings (correctie 4) ─────────────────────────────────────

function mapRole(value: unknown, where: string): "admin" | "member" {
  const role = str(value) ?? "guest"; // default bij invite
  if (role === "admin") return "admin";
  if (role === "guest" || role === "member") return "member";
  return fail(`onbekende rol '${role}' op ${where}`);
}

function mapFeatureStatus(
  value: unknown,
  where: string,
): "open" | "planned" | "inProgress" | "done" | "rejected" {
  const status = str(value) ?? "submitted";
  switch (status) {
    case "submitted":
      return "open";
    case "in progress":
      return "inProgress";
    case "completed":
      return "done";
    case "rejected":
      return "rejected";
    case "planned":
      return "planned";
    default:
      return fail(`onbekende feature-status '${status}' op ${where}`);
  }
}

function isInvite(item: SourceItem): boolean {
  return str(item.status) === "invite";
}

// ── de transform zelf ─────────────────────────────────────────────────

export function transform(items: SourceItem[], config: TransformConfig): TransformResult {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const filtered = new Map<string, number>();
  const countFiltered = (reason: string) =>
    filtered.set(reason, (filtered.get(reason) ?? 0) + 1);

  if (config.target === "dev" && (config.chosenUserIds === null || config.chosenUserIds.length === 0)) {
    fail(
      "dev-config zonder chosenUserIds. Een leeg filter zou stilzwijgend de " +
        "volledige productie-set naar dev schrijven; dat is een configuratiefout.",
    );
  }

  const src = parse(items);
  for (const [prefix, count] of src.unknown) {
    warn(`bron: ${count} item(s) met onbekend PK-patroon '${prefix}' overgeslagen`);
  }

  // ── founders (correctie 5) ──────────────────────────────────────────
  // groups.createdBy heeft geen bronveld; hij komt van de membership met
  // isFounder. Ontbreekt die, dan stopt de run — niet stilletjes de oudste
  // member pakken. Ontsnapping: founderOverrides per groupId.
  const founderByGroup = new Map<string, string>();
  for (const m of src.memberships) {
    if (m.item.isFounder === true && !isInvite(m.item)) {
      founderByGroup.set(m.groupId, m.inviteeKey);
    }
  }
  for (const [groupId, userId] of Object.entries(config.founderOverrides ?? {})) {
    founderByGroup.set(groupId, userId);
    warn(`groep ${groupId}: createdBy uit config-override (${userId})`);
  }
  for (const groupId of src.groups.keys()) {
    if (!founderByGroup.has(groupId)) {
      fail(
        `groep ${groupId} heeft geen membership met isFounder — groups.createdBy ` +
          `is niet af te leiden. Zet een founderOverrides-entry voor ${groupId} als ` +
          `je weet wie het is.`,
      );
    }
  }

  // ── inclusie-set (dev-filter) ───────────────────────────────────────
  // Filteren gebeurt hier, cascade-consistent van boven naar beneden. Na deze
  // fase resolvet elke verplichte FK binnen de set, of het is een bronfout en
  // de transform stopt.
  const chosen = config.chosenUserIds === null ? null : new Set(config.chosenUserIds);
  if (chosen !== null) {
    for (const userId of chosen) {
      if (!src.users.has(userId)) {
        fail(
          `chosen user ${userId} bestaat niet in het extract. Een typefout hier ` +
            `levert een stilzwijgend kleinere seed op.`,
        );
      }
    }
  }

  const includedUsers = new Set<string>(
    [...src.users.keys()].filter((id) => chosen === null || chosen.has(id)),
  );

  // Groep hoort erbij als minstens één chosen user lid is én de founder chosen
  // is (besluit Wouter 2026-08-23: geen vierde Clerk-dev-account, dus een groep
  // met een niet-chosen founder valt af in plaats van dat we createdBy verzinnen).
  const includedGroups = new Set<string>();
  for (const groupId of src.groups.keys()) {
    if (chosen === null) {
      includedGroups.add(groupId);
      continue;
    }
    const founder = founderByGroup.get(groupId)!;
    if (!includedUsers.has(founder)) {
      countFiltered("groep uitgesloten: founder niet chosen");
      continue;
    }
    const hasChosenMember = src.memberships.some(
      (m) => m.groupId === groupId && !isInvite(m.item) && includedUsers.has(m.inviteeKey),
    );
    if (!hasChosenMember) {
      countFiltered("groep uitgesloten: geen chosen member");
      continue;
    }
    includedGroups.add(groupId);
  }

  const includedAlbums = new Set<string>();
  for (const [albumId, album] of src.albums) {
    if (includedGroups.has(album.groupId)) includedAlbums.add(albumId);
    else countFiltered("album uitgesloten: groep niet opgenomen");
  }

  const includedPhotos = new Set<string>();
  for (const [photoId, photo] of src.photos) {
    if (!includedUsers.has(photo.ownerId)) {
      if (src.users.has(photo.ownerId)) countFiltered("foto uitgesloten: eigenaar niet chosen");
      else warn(`foto ${photoId}: eigenaar ${photo.ownerId} bestaat niet als user — overgeslagen`);
      continue;
    }
    if (str(photo.item.url) === undefined) {
      warn(`foto ${photoId}: geen S3-sleutel (url leeg) — overgeslagen`);
      continue;
    }
    includedPhotos.add(photoId);
  }

  // ── anonimisatie-mappings ───────────────────────────────────────────
  // Stabiel (gesorteerd, niet volgorde-van-binnenkomst) en injectief: twee
  // bron-users worden nooit één dev-user.
  const anonIndex = new Map<string, number>();
  [...includedUsers].sort().forEach((userId, i) => anonIndex.set(userId, i + 1));

  const anonName = (userId: string): string => {
    const n = anonIndex.get(userId)!;
    return DEV_NAMES[n - 1] ?? `Dev User ${n}`;
  };
  const anonUserEmail = (userId: string): string => `dev-${anonIndex.get(userId)!}@clubalmanac.test`;

  // Invitees zonder account hebben geen user-record; hun adres ís hun bron-ID.
  const anonInviteeEmail = new Map<string, string>();
  const registerInvitee = (rawEmail: string): void => {
    if (!anonInviteeEmail.has(rawEmail)) {
      anonInviteeEmail.set(rawEmail, `invitee-${anonInviteeEmail.size + 1}@clubalmanac.test`);
    }
  };

  const displayName = (userId: string, raw: string | undefined): string | undefined =>
    config.anonymize ? anonName(userId) : raw;
  const userEmail = (userId: string, raw: string): string =>
    config.anonymize ? anonUserEmail(userId) : raw;
  const inviteeEmail = (raw: string): string => {
    if (!config.anonymize) return raw;
    registerInvitee(raw);
    return anonInviteeEmail.get(raw)!;
  };

  /**
   * Anonimisatie geldt over álles wat de transform verlaat, niet alleen over de
   * records (WP12 fix-cyclus 1, S-1). De waarschuwingen worden mee weggeschreven
   * in convex-records.json en staan daarmee op dezelfde laptop; een
   * overgeslagen record wordt gemeld met zijn bron-sleutel, en die sleutel ís
   * een emailadres als de genodigde geen account heeft.
   *
   * Daarom één scrub over de hele tekst in plaats van een ingreep per meldpunt:
   * een nieuw meldpunt erbij mag geen nieuw lek zijn. Adressen van bestaande
   * users krijgen hun dev-adres, de rest hetzelfde stabiele invitee-alias als in
   * de records — de melding blijft dus herleidbaar, alleen de identiteit is weg.
   */
  const anonymizeText = (message: string): string => {
    if (!config.anonymize) return message;
    return message.replace(EMAIL_IN_TEXT, (raw) => {
      const normalized = normalizeEmail(raw);
      if (normalized === undefined || normalized.endsWith(`@${ANON_DOMAIN}`)) return raw;
      const userId = emailToUserId.get(normalized);
      return userId !== undefined ? anonUserEmail(userId) : inviteeEmail(normalized);
    });
  };

  const records: Records = emptyRecords();

  // ── users ───────────────────────────────────────────────────────────
  // Vier bronrecords (UBbase / UPstats / UVvisit / USER) worden één rij.
  // De map dient twee doelen: botsende adressen betrappen, en de scrub laten
  // zien welk bron-adres bij welke user hoort.
  const emailToUserId = new Map<string, string>();
  for (const userId of [...includedUsers].sort()) {
    const user = src.users.get(userId)!;
    const subject = str(config.subjectByUserId[userId]);
    if (subject === undefined) {
      fail(
        `user ${userId} heeft geen Clerk-ID in de ID-map. Geen placeholder-subject: ` +
          `zonder mapping kan deze user nooit inloggen.`,
      );
    }
    const rawEmail = normalizeEmail(user.base.email);
    if (rawEmail === undefined) fail(`user ${userId} heeft geen email`);
    const clash = emailToUserId.get(rawEmail);
    if (clash !== undefined) {
      fail(
        `users ${clash} en ${userId} hebben na normalisatie hetzelfde emailadres. ` +
          `Geen "laatste wint" — dit moet in de bron opgelost worden.`,
      );
    }
    emailToUserId.set(rawEmail, userId);

    const createdAt = toEpoch(user.base.createdAt);
    if (createdAt === undefined) fail(`user ${userId} heeft geen bruikbare createdAt`);

    records.users.push({
      sourceKey: userId,
      subject,
      email: userEmail(userId, rawEmail),
      name: displayName(userId, str(user.base.name)),
      // S3-sleutel; load-records vervangt hem door het _storage-id. Kan buiten
      // protected/ liggen (gedeelde standaard-profielfoto) en hoeft geen
      // photos-record te hebben.
      profilePhotoStorageKey: str(user.base.photoUrl),
      photoCount: 0, // hertelling volgt na photos
      photoLimit: config.defaultPhotoLimit,
      lastVisitAt: toEpoch(user.visit?.visitDateLast),
      createdAt,
    });
  }

  // ── groups ──────────────────────────────────────────────────────────
  for (const [groupId, item] of src.groups) {
    if (!includedGroups.has(groupId)) continue;
    const createdBy = founderByGroup.get(groupId)!;
    if (!includedUsers.has(createdBy)) {
      fail(`groep ${groupId}: createdBy ${createdBy} zit niet in de output-set`);
    }
    const createdAt = toEpoch(item.createdAt);
    if (createdAt === undefined) fail(`groep ${groupId} heeft geen bruikbare createdAt`);
    const name = str(item.name);
    if (name === undefined) fail(`groep ${groupId} heeft geen naam`);

    let coverPhotoId = str(item.photoId);
    if (coverPhotoId !== undefined && !includedPhotos.has(coverPhotoId)) {
      warn(`groep ${groupId}: coverPhotoId ${coverPhotoId} resolvet niet — gewist`);
      coverPhotoId = undefined;
    }

    records.groups.push({
      sourceKey: groupId,
      name,
      description: str(item.description),
      coverPhotoId,
      createdBy,
      createdAt,
    });
  }

  // ── memberships + invites ───────────────────────────────────────────
  // Zelfde recordtype in de bron; `status: 'invite'` maakt het verschil.
  for (const m of src.memberships) {
    const { inviteeKey, groupId, item } = m;
    if (!includedGroups.has(groupId)) {
      if (src.groups.has(groupId)) countFiltered("membership/invite uitgesloten: groep niet opgenomen");
      else warn(`membership ${inviteeKey}#${groupId}: groep bestaat niet — overgeslagen`);
      continue;
    }

    if (!isInvite(item)) {
      if (!includedUsers.has(inviteeKey)) {
        if (src.users.has(inviteeKey)) countFiltered("membership uitgesloten: user niet chosen");
        else warn(`membership ${inviteeKey}#${groupId}: user bestaat niet — overgeslagen`);
        continue;
      }
      const joinedAt = toEpoch(item.createdAt);
      if (joinedAt === undefined) fail(`membership ${inviteeKey}#${groupId} heeft geen createdAt`);
      records.memberships.push({
        sourceKey: `${inviteeKey}#${groupId}`,
        userId: inviteeKey,
        groupId,
        role: mapRole(item.role, `membership ${inviteeKey}#${groupId}`),
        joinedAt,
      });
      continue;
    }

    // Invite. De invitee is een user (PK `UMU{sub}`) óf een emailadres
    // (PK `UM{email}`); in beide gevallen wordt het een invites-rij en nooit
    // een membership. `user.email` is leidend boven de sleutel: de invitee kan
    // zijn adres later gewijzigd hebben.
    //
    // Dev-filterregel. Het migratieplan zegt "Invites: alleen tussen de 3
    // chosen", maar een invite aan iemand zónder account is juist het normale
    // geval — die persoon kán geen chosen user zijn. Gelezen als: de
    // **uitnodiger** moet chosen zijn (dat is ook de enige verplichte FK,
    // `invitedBy`), de groep opgenomen, en als de genodigde wél een bestaande
    // user is moet die chosen zijn. Anders zou de dev-seed nul invites bevatten
    // en is de invite-flow er niet op te testen.
    const inviteeIsUser = src.users.has(inviteeKey);
    if (inviteeIsUser && !includedUsers.has(inviteeKey)) {
      countFiltered("invite uitgesloten: genodigde niet chosen");
      continue;
    }
    const nested = (item.user ?? {}) as SourceItem;
    const rawEmail =
      normalizeEmail(nested.email) ?? (inviteeKey.includes("@") ? normalizeEmail(inviteeKey) : undefined);
    if (rawEmail === undefined) {
      warn(`invite ${inviteeKey}#${groupId}: geen emailadres te vinden — overgeslagen`);
      continue;
    }

    const invitation = (item.invitation ?? {}) as SourceItem;
    const inviter = str((invitation.from as SourceItem | undefined)?.SK);
    if (inviter === undefined) {
      fail(`invite ${inviteeKey}#${groupId}: geen uitnodiger (invitation.from) — invitedBy is verplicht`);
    }
    if (!includedUsers.has(inviter)) {
      if (src.users.has(inviter)) {
        countFiltered("invite uitgesloten: uitnodiger niet chosen");
        continue;
      }
      fail(`invite ${inviteeKey}#${groupId}: uitnodiger ${inviter} bestaat niet als user`);
    }

    const createdAt = toEpoch(item.createdAt);
    if (createdAt === undefined) fail(`invite ${inviteeKey}#${groupId} heeft geen createdAt`);
    const expiresAt = createdAt + INVITE_TTL_MS;

    // Sleutel én token dragen PII: de bron-ID van een invite aan iemand zonder
    // account ís zijn adres, en de oude token is base64 van {PK, SK}. Beide
    // worden vervangen — de invariant gaat over wat de transform verlaat, niet
    // over wat de database haalt.
    const keyPart = inviteeIsUser ? inviteeKey : inviteeEmail(rawEmail);
    const sourceKey = `${keyPart}#${groupId}`;

    records.invites.push({
      sourceKey,
      email: inviteeIsUser ? userEmail(inviteeKey, rawEmail) : inviteeEmail(rawEmail),
      invitedBy: inviter,
      groupId,
      role: mapRole(item.role, `invite ${sourceKey}`),
      token: `mig${stableHash(sourceKey)}`,
      // Geaccepteerde/geweigerde invites bestaan niet meer als record; alleen
      // pending en expired zijn te migreren.
      status: expiresAt <= config.now ? "expired" : "pending",
      expiresAt,
      createdAt,
      respondedAt: undefined,
      bouncedAt: undefined,
    });
  }

  // ── albums ──────────────────────────────────────────────────────────
  for (const [albumId, album] of src.albums) {
    if (!includedAlbums.has(albumId)) continue;
    const createdAt = toEpoch(album.item.createdAt);
    if (createdAt === undefined) fail(`album ${albumId} heeft geen bruikbare createdAt`);
    const name = str(album.item.name);
    if (name === undefined) fail(`album ${albumId} heeft geen naam`);
    // De bron kent geen albums.createdBy, in geen enkele vorm. Terugval op de
    // founder van de groep — gesynthetiseerd, dus expliciet gemeld.
    const createdBy = founderByGroup.get(album.groupId)!;
    warn(
      `album ${albumId}: createdBy gesynthetiseerd uit groups.createdBy (${createdBy}) — de bron heeft dit veld niet`,
    );
    records.albums.push({
      sourceKey: albumId,
      groupId: album.groupId,
      name,
      description: undefined, // createAlbum.js schrijft 'm nooit
      coverPhotoId: undefined,
      createdBy,
      createdAt,
    });
  }

  // ── photos ──────────────────────────────────────────────────────────
  for (const [photoId, photo] of src.photos) {
    if (!includedPhotos.has(photoId)) continue;
    const item = photo.item;
    const createdAt = toEpoch(item.createdAt);
    if (createdAt === undefined) fail(`foto ${photoId} heeft geen bruikbare createdAt`);

    let flaggedBy = str(item.flaggedBy);
    if (flaggedBy !== undefined && !includedUsers.has(flaggedBy)) {
      warn(`foto ${photoId}: flaggedBy ${flaggedBy} resolvet niet — gewist`);
      flaggedBy = undefined;
    }

    records.photos.push({
      sourceKey: photoId,
      ownerId: photo.ownerId,
      // S3-sleutel; load-records vervangt hem door het _storage-id.
      storageKey: str(item.url)!,
      filename: undefined,
      mimeType: undefined,
      width: undefined,
      height: undefined,
      takenAt: toEpoch(item.exifDate),
      latitude: num(item.exifLat),
      longitude: num(item.exifLon),
      locationLabel: str(item.exifAddress),
      exifOrientation: undefined, // de oude app roteerde de bytes zelf
      ratingAverage: undefined, // volgt uit de ratings hieronder
      ratingCount: 0,
      flaggedAt: toEpoch(item.flaggedDate),
      flaggedBy,
      flagReason: undefined,
      flaggedDeleteDate: toEpoch(item.flaggedDeleteDate),
      flaggedAppealDate: toEpoch(item.flaggedAppealDate),
      flaggedAppealDenyDate: toEpoch(item.flaggedAppealDenyDate),
      createdAt,
    });
  }

  // ── albumPhotos ─────────────────────────────────────────────────────
  for (const ap of src.albumPhotos) {
    if (!includedAlbums.has(ap.albumId)) {
      if (src.albums.has(ap.albumId)) countFiltered("albumfoto uitgesloten: album niet opgenomen");
      else warn(`albumfoto ${ap.albumId}#${ap.photoId}: album bestaat niet — overgeslagen`);
      continue;
    }
    if (!includedPhotos.has(ap.photoId)) {
      if (src.photos.has(ap.photoId)) countFiltered("albumfoto uitgesloten: foto niet opgenomen");
      else warn(`albumfoto ${ap.albumId}#${ap.photoId}: foto bestaat niet — overgeslagen`);
      continue;
    }
    const album = src.albums.get(ap.albumId)!;
    if (album.groupId !== ap.groupId) {
      // Bronfout: de groep in de GP-sleutel wijkt af van de groep van het album.
      warn(
        `albumfoto ${ap.albumId}#${ap.photoId}: groupId ${ap.groupId} in de sleutel ` +
          `wijkt af van album-groupId ${album.groupId} — album is leidend`,
      );
    }
    const addedAt = toEpoch(ap.item.createdAt);
    if (addedAt === undefined) fail(`albumfoto ${ap.albumId}#${ap.photoId} heeft geen createdAt`);
    // addedBy bestaat niet op GP. Terugval op de eigenaar van de foto: beide
    // schrijfpaden lieten alleen je eigen foto publiceren.
    const addedBy = src.photos.get(ap.photoId)!.ownerId;
    records.albumPhotos.push({
      sourceKey: `${album.groupId}#${ap.albumId}#${ap.photoId}`,
      albumId: ap.albumId,
      photoId: ap.photoId,
      groupId: album.groupId,
      addedAt,
      addedBy,
    });
  }

  // ── ratings (likes, 0/1) ────────────────────────────────────────────
  for (const r of src.ratings) {
    const value = num(r.item.rating) ?? 0;
    if (value !== 1) {
      // rating 0 = like weer ingetrokken. Geen rij.
      continue;
    }
    if (!includedPhotos.has(r.photoId)) {
      if (src.photos.has(r.photoId)) countFiltered("like uitgesloten: foto niet opgenomen");
      else warn(`like ${r.photoId}#${r.userId}: foto bestaat niet — overgeslagen`);
      continue;
    }
    if (!includedUsers.has(r.userId)) {
      if (src.users.has(r.userId)) countFiltered("like uitgesloten: user niet opgenomen");
      else warn(`like ${r.photoId}#${r.userId}: user bestaat niet — overgeslagen`);
      continue;
    }
    const createdAt = toEpoch(r.item.createdAt);
    if (createdAt === undefined) fail(`like ${r.photoId}#${r.userId} heeft geen createdAt`);
    records.ratings.push({
      sourceKey: `${r.photoId}#${r.userId}`,
      photoId: r.photoId,
      userId: r.userId,
      value: 1,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // ── features (correctie 3) ──────────────────────────────────────────
  for (const [featureId, item] of src.features) {
    const submittedBy = str(item.userId) ?? str((item.user as SourceItem | undefined)?.SK);
    if (submittedBy === undefined) fail(`feature ${featureId} heeft geen indiener`);
    if (!includedUsers.has(submittedBy)) {
      if (src.users.has(submittedBy)) {
        countFiltered("feature uitgesloten: indiener niet chosen");
        continue;
      }
      fail(`feature ${featureId}: indiener ${submittedBy} bestaat niet als user`);
    }
    const createdAt = toEpoch(item.createdAt);
    if (createdAt === undefined) fail(`feature ${featureId} heeft geen bruikbare createdAt`);

    // De bron kent geen per-user upvote-records: `votes` is één anonieme teller
    // die op 10 begint. upvoteCount 0 houdt de WP10-integriteitscheck schoon;
    // de oude waarde staat hier zodat Wouter 'm desgewenst handmatig terugzet.
    const votes = num(item.votes);
    if (votes !== undefined) {
      warn(
        `feature ${featureId}: stemscore votes=${votes} gaat verloren — upvoteCount wordt 0 ` +
          `en er komen geen featureUpvotes-records (de bron kent geen stemmer)`,
      );
    }
    const comment = str(item.comment);
    if (comment !== undefined) {
      warn(`feature ${featureId}: webmaster-notitie 'comment' heeft geen Convex-veld en gaat verloren`);
    }

    records.features.push({
      sourceKey: featureId,
      type: "feature", // problem-reports gingen alleen per mail, nooit naar DynamoDB
      title: str(item.title) ?? "(zonder titel)",
      description: str(item.description) ?? "",
      submittedBy,
      status: mapFeatureStatus(item.status, `feature ${featureId}`),
      upvoteCount: 0,
      createdAt,
    });
  }

  // ── aggregates (uit de rijen die geladen worden) ────────────────────
  const photoCountByOwner = new Map<string, number>();
  for (const p of records.photos) {
    const owner = p.ownerId as string;
    photoCountByOwner.set(owner, (photoCountByOwner.get(owner) ?? 0) + 1);
  }
  for (const u of records.users) {
    u.photoCount = photoCountByOwner.get(u.sourceKey) ?? 0;
  }
  const likesByPhoto = new Map<string, number>();
  for (const r of records.ratings) {
    const photoId = r.photoId as string;
    likesByPhoto.set(photoId, (likesByPhoto.get(photoId) ?? 0) + 1);
  }
  for (const p of records.photos) {
    const count = likesByPhoto.get(p.sourceKey) ?? 0;
    p.ratingCount = count;
    // Het oude "rating" is een like: ratingAverage is 1 zodra er één like is,
    // en afwezig bij nul — precies zoals integrityCheck 'm herrekent.
    p.ratingAverage = count > 0 ? 1 : undefined;
  }

  // ── albumLastSeen (correctie 2) ─────────────────────────────────────
  deriveAlbumLastSeen({ src, records, includedAlbums, includedUsers, warn });

  // ── slotcontrole + rapport ──────────────────────────────────────────
  assertReferentiallyClosed(records);

  for (const [reason, count] of [...filtered].sort()) {
    warn(`filter (${config.target}): ${count}× ${reason}`);
  }
  warn(
    "niet-migreerbare velden: photos.mimeType/filename/width/height/exifOrientation/flagReason " +
      "bestaan niet in DynamoDB en blijven leeg",
  );

  return { records, warnings: warnings.map(anonymizeText) };
}

// ── albumLastSeen ─────────────────────────────────────────────────────
//
// `seenPics` is een ONGELEZEN-wachtrij, geen historie van gelezen foto's:
// bij elke nieuwe albumfoto komt er een entry bij voor álle groepsleden behalve
// de eigenaar, en een entry krijgt pas een `seenDate` als hij getoond is (daarna
// wordt hij opgeruimd). Entry zónder seenDate = ongelezen.
//
// Richtings-invariant: fout mag richting "te veel ongelezen", nooit richting
// "ten onrechte gelezen". Omdat de bron alleen kalenderdagen kent, betekent dat
// bij een gelezen én een ongelezen foto op dezelfde dag: allebei ongelezen.
function deriveAlbumLastSeen(args: {
  src: Parsed;
  records: Records;
  includedAlbums: Set<string>;
  includedUsers: Set<string>;
  warn: (message: string) => void;
}): void {
  const { src, records, includedAlbums, includedUsers, warn } = args;

  // albumId → photoId → addedAt, uit de rijen die daadwerkelijk geladen worden.
  const photosByAlbum = new Map<string, Map<string, number>>();
  for (const ap of records.albumPhotos) {
    const albumId = ap.albumId as string;
    const perAlbum = photosByAlbum.get(albumId) ?? new Map<string, number>();
    perAlbum.set(ap.photoId as string, ap.addedAt as number);
    photosByAlbum.set(albumId, perAlbum);
  }
  const albumsByGroup = new Map<string, string[]>();
  for (const album of records.albums) {
    const groupId = album.groupId as string;
    albumsByGroup.set(groupId, [...(albumsByGroup.get(groupId) ?? []), album.sourceKey]);
  }

  const emitted = new Set<string>();
  for (const m of src.memberships) {
    if (isInvite(m.item)) continue;
    if (!includedUsers.has(m.inviteeKey)) continue;
    const albums = albumsByGroup.get(m.groupId);
    if (albums === undefined) continue;

    // Ongelezen entries van deze membership, per album.
    const unreadByAlbum = new Map<string, Set<string>>();
    const entries = Array.isArray(m.item.seenPics) ? (m.item.seenPics as SourceItem[]) : [];
    for (const entry of entries) {
      const albumId = str(entry?.albumId);
      const photoId = str(entry?.photoId);
      if (albumId === undefined || photoId === undefined) {
        warn(`seenPics-entry van ${m.inviteeKey}#${m.groupId} zonder albumId/photoId — overgeslagen`);
        continue;
      }
      if (!includedAlbums.has(albumId) || !albums.includes(albumId)) {
        warn(
          `seenPics-entry ${albumId}/${photoId} van ${m.inviteeKey}: album hoort niet bij ` +
            `groep ${m.groupId} of bestaat niet meer — overgeslagen`,
        );
        continue;
      }
      if (!(photosByAlbum.get(albumId)?.has(photoId) ?? false)) {
        warn(
          `seenPics-entry ${albumId}/${photoId} van ${m.inviteeKey}: foto ${photoId} staat niet ` +
            `(meer) in het album — overgeslagen`,
        );
        continue;
      }
      if (str(entry.seenDate) !== undefined) continue; // gelezen
      const set = unreadByAlbum.get(albumId) ?? new Set<string>();
      set.add(photoId);
      unreadByAlbum.set(albumId, set);
    }

    for (const albumId of albums) {
      const key = `${m.inviteeKey}#${albumId}`;
      if (emitted.has(key)) continue; // hooguit één rij per (user, album)
      const perAlbum = photosByAlbum.get(albumId);
      if (perAlbum === undefined || perAlbum.size === 0) continue; // fallback in albums.ts regelt dit
      const unread = unreadByAlbum.get(albumId);
      const lastSeenAt =
        unread !== undefined && unread.size > 0
          ? Math.min(...[...unread].map((photoId) => perAlbum.get(photoId)!)) - 1
          : Math.max(...perAlbum.values());
      emitted.add(key);
      records.albumLastSeen.push({
        sourceKey: key,
        userId: m.inviteeKey,
        albumId,
        lastSeenAt,
      });
    }
  }
}

// ── slotcontrole ──────────────────────────────────────────────────────
//
// Na filtering resolvet elke verplichte FK binnen de set, of de transform stopt
// met de bron-sleutel in de melding. Optionele FK's die niet resolven zijn
// hierboven al gewist en geteld.
function assertReferentiallyClosed(records: Records): void {
  const keysOf = (table: keyof Records) => new Set(records[table].map((r) => r.sourceKey));
  const cache = new Map<string, Set<string>>();
  const keys = (table: keyof Records) => {
    const hit = cache.get(table);
    if (hit) return hit;
    const built = keysOf(table);
    cache.set(table, built);
    return built;
  };

  for (const [table, specs] of Object.entries(FKS) as Array<[keyof Records, typeof FKS[keyof typeof FKS]]>) {
    for (const row of records[table]) {
      for (const spec of specs) {
        const value = row[spec.field];
        if (value === undefined || value === null) {
          if (spec.required) {
            fail(`${table}.${spec.field} ontbreekt op ${row.sourceKey}`);
          }
          continue;
        }
        if (!keys(spec.target).has(value as string)) {
          fail(
            `${table}.${spec.field}=${String(value)} op ${row.sourceKey} resolvet niet in ${spec.target}`,
          );
        }
      }
    }
  }
}
