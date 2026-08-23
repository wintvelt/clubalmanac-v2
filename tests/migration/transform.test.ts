import { describe, expect, test } from "vitest";

// WP12 — RED tests op de `transform`-stap van de data-migratie-tooling.
// Zie docs/work-packages/WP12-data-migratie-tooling.md.
//
// Wat deze suite pint is gedrag, niet vorm: "wat de user in de oude app zag,
// ziet hij na migratie ook". De zes correcties uit de spec-criticus-pass zijn
// stuk voor stuk semantische valkuilen — data die er correct uitziet en het
// niet is. Ze zijn hier expliciet gepind omdat geen enkele runtime-check ze
// zou vangen.
//
// `transform` is bewust een pure functie: extract-items in, Convex-vormige
// records uit, zonder AWS- of Convex-verbinding. Het uitvoerformaat ligt vast
// in §Transform-outputcontract van de spec:
//   - per Convex-tabel een lijst rijen met Convex-veldnamen;
//   - elke rij draagt een `sourceKey` = de natuurlijke bron-ID;
//   - FK-velden bevatten de `sourceKey` van het doel, nog geen Convex-_id;
//   - storage-verwijzingen zijn S3-sleutels (`storageKey`,
//     `profilePhotoStorageKey`), nog geen `_storage`-id.
//
// De prod-ID-map is in werkelijkheid email → Clerk-ID; die wordt tijdens
// config-voorbereiding herleid naar `U{sub}` → Clerk-ID, zodat transform zelf
// één code-pad houdt (spec-invariant "één tool, twee configuraties").
import { transform } from "../../scripts/migrate/transform";
import {
  buildExtract,
  CHOSEN,
  day,
  DEV_SUBJECTS,
  PROD_SUBJECTS,
  SOURCE_PII,
} from "./fixture";
import { OPTIONAL_FK_ORACLE, REQUIRED_FK_ORACLE } from "./fkOracle";

const NOW = day("2026-08-23");
const DAY_MS = 24 * 60 * 60 * 1000;

const devConfig = {
  target: "dev" as const,
  chosenUserIds: CHOSEN,
  anonymize: true,
  subjectByUserId: DEV_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};

const prodConfig = {
  target: "prod" as const,
  chosenUserIds: null,
  anonymize: false,
  subjectByUserId: PROD_SUBJECTS,
  defaultPhotoLimit: 1000,
  now: NOW,
};

const runProd = () => transform(buildExtract(), prodConfig);
const runDev = () => transform(buildExtract(), devConfig);

type Row = Record<string, any>;
const bySource = (rows: Row[], key: string): Row => {
  const found = rows.filter((r) => r.sourceKey === key);
  expect(found, `geen unieke rij met sourceKey ${key}`).toHaveLength(1);
  return found[0]!;
};

// ────────────────────────────────────────────────────────────────────────
// Correctie 1 — kalenderdagen, geen timestamps
// ────────────────────────────────────────────────────────────────────────
describe("datums", () => {
  test("YYYY-MM-DD wordt epoch-ms op UTC-middernacht van diezelfde dag", () => {
    const { records } = runProd();
    const photo = bySource(records.photos, "P-alice-1");
    expect(photo.createdAt).toBe(day("2021-04-05"));
    expect(new Date(photo.createdAt).toISOString().slice(0, 10)).toBe("2021-04-05");
  });

  test("exifDate landt als takenAt op dezelfde kalenderdag", () => {
    const { records } = runProd();
    expect(bySource(records.photos, "P-alice-1").takenAt).toBe(day("2021-04-04"));
  });

  test("foto's van dezelfde brondag krijgen dezelfde timestamp — geen verzonnen spreiding", () => {
    const { records } = runProd();
    expect(bySource(records.photos, "P-bob-1").createdAt).toBe(
      bySource(records.photos, "P-bob-2").createdAt,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// users — vier bronrecords, één rij
// ────────────────────────────────────────────────────────────────────────
describe("users", () => {
  test("UBbase + UPstats + UVvisit smelten samen tot één rij per user", () => {
    const { records } = runProd();
    expect(records.users.filter((u: Row) => u.sourceKey === "U-alice")).toHaveLength(1);
    const alice = bySource(records.users, "U-alice");
    expect(alice.createdAt).toBe(day("2021-03-01"));
    expect(alice.lastVisitAt).toBe(day("2026-08-01"));
  });

  test("het afgeleide USER-record levert geen tweede user op", () => {
    const { records } = runProd();
    expect(records.users).toHaveLength(4);
  });

  test("subject komt uit de ID-map, niet uit de Cognito-sub", () => {
    const { records } = runProd();
    expect(bySource(records.users, "U-alice").subject).toBe("user_devalice");
    expect(bySource(records.users, "U-dave").subject).toBe("user_proddave");
  });

  test("ontbrekende subject-mapping is een harde fout, geen placeholder", () => {
    expect(() =>
      transform(buildExtract(), { ...prodConfig, subjectByUserId: DEV_SUBJECTS }),
    ).toThrow(/U-dave/);
  });

  test("email wordt genormaliseerd naar lowercase", () => {
    const { records } = runProd();
    expect(bySource(records.users, "U-alice").email).toBe("alice.bronwerk@example.test");
  });

  test("photoCount wordt herteld uit de PO-records, niet overgenomen uit UPstats", () => {
    const { records } = runProd();
    // UPstats zegt 99; alice heeft in werkelijkheid 2 foto's.
    expect(bySource(records.users, "U-alice").photoCount).toBe(2);
    expect(bySource(records.users, "U-carol").photoCount).toBe(0);
  });

  test("photoLimit valt terug op de default uit de config", () => {
    const { records } = runProd();
    expect(bySource(records.users, "U-bob").photoLimit).toBe(1000);
  });

  test("profielfoto wordt een S3-sleutel, ook als het een gedeelde standaardfoto is", () => {
    const { records } = runProd();
    expect(bySource(records.users, "U-alice").profilePhotoStorageKey).toBe(
      "protected/U-alice-sub/U-alice-avatar.jpg",
    );
    expect(bySource(records.users, "U-bob").profilePhotoStorageKey).toBe(
      "public/img/knorren/knor7.jpg",
    );
  });

  test("lege-string-sentinel telt als afwezig, niet als lege waarde", () => {
    const { records } = runProd();
    const carol = bySource(records.users, "U-carol");
    expect(carol.profilePhotoStorageKey).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Correctie 4 — rollen, statussen, types
// ────────────────────────────────────────────────────────────────────────
describe("memberships", () => {
  test("guest wordt member, admin blijft admin", () => {
    const { records } = runProd();
    expect(bySource(records.memberships, "U-bob#G-1").role).toBe("member");
    expect(bySource(records.memberships, "U-alice#G-1").role).toBe("admin");
  });

  test("een record zonder status-veld is gewoon lid", () => {
    const { records } = runProd();
    expect(bySource(records.memberships, "U-alice#G-1").joinedAt).toBe(day("2021-04-01"));
  });

  test("status 'invite' levert géén membership op", () => {
    const { records } = runProd();
    const keys = records.memberships.map((m: Row) => m.sourceKey);
    expect(keys).not.toContain("U-carol#G-1");
    expect(keys).not.toContain("genodigde@example.test#G-1");
  });
});

describe("invites", () => {
  test("een invite naar een emailadres zonder account wordt een invite-rij", () => {
    const { records } = runProd();
    const invite = bySource(records.invites, "genodigde@example.test#G-1");
    expect(invite.email).toBe("genodigde@example.test");
    expect(invite.invitedBy).toBe("U-alice");
    expect(invite.groupId).toBe("G-1");
    expect(invite.role).toBe("member");
  });

  test("een invite naar een bestaande user is óók een invite, geen membership", () => {
    const { records } = runProd();
    const invite = bySource(records.invites, "U-carol#G-1");
    expect(invite.email).toBe("carol@example.test");
    expect(invite.role).toBe("admin");
  });

  test("expiresAt is 30 dagen na createdAt", () => {
    const { records } = runProd();
    expect(bySource(records.invites, "genodigde@example.test#G-1").expiresAt).toBe(
      day("2026-08-20") + 30 * DAY_MS,
    );
  });

  test("status volgt uit de vervaldatum, niet uit een bronveld", () => {
    const { records } = runProd();
    expect(bySource(records.invites, "genodigde@example.test#G-1").status).toBe("pending");
    expect(bySource(records.invites, "U-carol#G-1").status).toBe("expired");
  });

  test("respondedAt en bouncedAt blijven leeg — die historie bestaat niet in de bron", () => {
    const { records } = runProd();
    const invite = bySource(records.invites, "genodigde@example.test#G-1");
    expect(invite.respondedAt).toBeUndefined();
    expect(invite.bouncedAt).toBeUndefined();
  });

  test("elke invite heeft een niet-lege, unieke token", () => {
    const { records } = runProd();
    const tokens = records.invites.map((i: Row) => i.token);
    expect(tokens.every((t: string) => typeof t === "string" && t.length > 0)).toBe(true);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Correctie 5 — verplichte velden zonder bron
// ────────────────────────────────────────────────────────────────────────
describe("groups", () => {
  test("createdBy komt van de membership met isFounder", () => {
    const { records } = runProd();
    expect(bySource(records.groups, "G-1").createdBy).toBe("U-alice");
    expect(bySource(records.groups, "G-2").createdBy).toBe("U-dave");
  });

  test("een groep zonder founder-membership stopt de run", () => {
    const extract = buildExtract().filter(
      (i: any) => !(i.PK === "UMU-dave" && i.SK === "G-2"),
    );
    expect(() => transform(extract, prodConfig)).toThrow(/G-2/);
  });

  test("coverPhotoId verwijst naar de foto, description blijft behouden", () => {
    const { records } = runProd();
    const g1 = bySource(records.groups, "G-1");
    expect(g1.coverPhotoId).toBe("P-alice-1");
    expect(g1.description).toBe("Elke zondag");
  });

  test("lege description landt niet als lege string", () => {
    const { records } = runProd();
    expect(bySource(records.groups, "G-2").description).toBeUndefined();
  });
});

describe("albums", () => {
  test("createdBy valt terug op de founder van de groep — de bron heeft het veld niet", () => {
    const { records } = runProd();
    const a1 = bySource(records.albums, "A-1");
    expect(a1.groupId).toBe("G-1");
    expect(a1.createdBy).toBe("U-alice");
  });

  test("gesynthetiseerde velden worden gemeld, niet stilzwijgend ingevuld", () => {
    const { warnings } = runProd();
    expect(warnings.some((w: string) => /A-1/.test(w) && /createdBy/i.test(w))).toBe(true);
  });

  test("description bestaat niet in de bron en blijft leeg", () => {
    const { records } = runProd();
    expect(bySource(records.albums, "A-1").description).toBeUndefined();
  });
});

describe("albumPhotos", () => {
  test("addedBy is de eigenaar van de foto — alleen eigen foto's konden gepubliceerd worden", () => {
    const { records } = runProd();
    const ap = bySource(records.albumPhotos, "G-1#A-1#P-bob-1");
    expect(ap.addedBy).toBe("U-bob");
    expect(ap.albumId).toBe("A-1");
    expect(ap.photoId).toBe("P-bob-1");
    expect(ap.groupId).toBe("G-1");
    expect(ap.addedAt).toBe(day("2021-04-06"));
  });
});

describe("photos", () => {
  test("eigenaar en S3-sleutel komen uit het PO-record", () => {
    const { records } = runProd();
    const p = bySource(records.photos, "P-alice-1");
    expect(p.ownerId).toBe("U-alice");
    expect(p.storageKey).toBe("protected/U-alice-sub/vroeg.jpg");
  });

  test("exif-locatie landt als coördinaten plus label", () => {
    const { records } = runProd();
    const p = bySource(records.photos, "P-alice-1");
    expect(p.latitude).toBeCloseTo(52.16);
    expect(p.longitude).toBeCloseTo(4.49);
    expect(p.locationLabel).toBe("Leiden");
  });

  test("flag-state blijft intact; lege flaggedDeleteDate telt als afwezig", () => {
    const { records } = runProd();
    const p = bySource(records.photos, "P-alice-2");
    expect(p.flaggedAt).toBe(day("2026-08-10"));
    expect(p.flaggedBy).toBe("U-bob");
    expect(p.flaggedAppealDate).toBe(day("2026-08-12"));
    expect(p.flaggedDeleteDate).toBeUndefined();
  });

  test("velden die de bron niet heeft blijven leeg in plaats van geraden", () => {
    const { records } = runProd();
    const p = bySource(records.photos, "P-alice-1");
    expect(p.mimeType).toBeUndefined();
    expect(p.width).toBeUndefined();
    expect(p.exifOrientation).toBeUndefined();
    expect(p.flagReason).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Correctie 4 — ratings zijn likes (0/1), geen 1..5-score
// ────────────────────────────────────────────────────────────────────────
describe("ratings", () => {
  test("een actieve like wordt één rij met waarde 1", () => {
    const { records } = runProd();
    expect(bySource(records.ratings, "P-bob-1#U-alice").value).toBe(1);
  });

  test("een ingetrokken like (rating 0) levert géén rij op", () => {
    const { records } = runProd();
    expect(records.ratings.map((r: Row) => r.sourceKey)).not.toContain("P-bob-2#U-alice");
  });

  test("ratingCount op de foto is het aantal likes", () => {
    const { records } = runProd();
    expect(bySource(records.photos, "P-alice-1").ratingCount).toBe(2);
    expect(bySource(records.photos, "P-bob-1").ratingCount).toBe(1);
    expect(bySource(records.photos, "P-bob-2").ratingCount).toBe(0);
  });

  test("ratingAverage is 1 bij likes en afwezig bij nul — zoals de integrity-check hem herrekent", () => {
    const { records } = runProd();
    expect(bySource(records.photos, "P-alice-1").ratingAverage).toBe(1);
    expect(bySource(records.photos, "P-bob-2").ratingAverage).toBeUndefined();
  });

  test("de aggregates komen uit de transform en kloppen met de rijen die geladen worden", () => {
    const { records } = runProd();
    const counted = new Map<string, number>();
    for (const r of records.ratings as Row[]) {
      counted.set(r.photoId, (counted.get(r.photoId) ?? 0) + 1);
    }
    for (const p of records.photos as Row[]) {
      expect(p.ratingCount, `ratingCount van ${p.sourceKey}`).toBe(counted.get(p.sourceKey) ?? 0);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Correctie 3 — featureUpvotes heeft geen brondata
// ────────────────────────────────────────────────────────────────────────
describe("features", () => {
  test("statussen worden gemapt op het Convex-vocabulaire", () => {
    const { records } = runProd();
    expect(bySource(records.features, "F-1").status).toBe("open");
    expect(bySource(records.features, "F-2").status).toBe("inProgress");
    expect(bySource(records.features, "F-3").status).toBe("done");
  });

  test("alles is type feature — problem-reports gingen alleen per mail", () => {
    const { records } = runProd();
    expect(records.features.every((f: Row) => f.type === "feature")).toBe(true);
  });

  test("upvoteCount is 0 en er zijn geen upvote-rijen: de bron kent geen stemmer", () => {
    const { records } = runProd();
    expect(records.features.every((f: Row) => f.upvoteCount === 0)).toBe(true);
    expect(records.featureUpvotes).toHaveLength(0);
  });

  test("het verlies van de stemscore wordt gemeld, niet verzwegen", () => {
    const { warnings } = runProd();
    expect(warnings.some((w: string) => /F-1/.test(w) && /13/.test(w))).toBe(true);
  });

  test("submittedBy verwijst naar de indiener", () => {
    const { records } = runProd();
    expect(bySource(records.features, "F-1").submittedBy).toBe("U-alice");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Correctie 2 — seenPics is een ONGELEZEN-wachtrij
// ────────────────────────────────────────────────────────────────────────
describe("albumLastSeen", () => {
  test("een ongelezen foto blijft na migratie ongelezen", () => {
    // Alice heeft P-bob-2 nog niet gezien (geen seenDate). Die foto is op
    // 2021-04-06 toegevoegd; lastSeenAt moet er strikt vóór liggen, anders
    // valt de badge weg die ze in de oude app wél zag.
    const { records } = runProd();
    const row = bySource(records.albumLastSeen, "U-alice#A-1");
    expect(row.lastSeenAt).toBeLessThan(day("2021-04-06"));
  });

  test("bij een gelezen en een ongelezen foto op dezelfde dag wint ongelezen", () => {
    // P-bob-1 (gelezen) en P-bob-2 (ongelezen) staan allebei op 2021-04-06.
    // Dag-granulariteit maakt ze niet te scheiden; de spec-invariant zegt dan:
    // fout mag richting "te veel ongelezen", nooit richting "ten onrechte
    // gelezen".
    const { records } = runProd();
    const row = bySource(records.albumLastSeen, "U-alice#A-1");
    expect(row.lastSeenAt).toBe(day("2021-04-06") - 1);
  });

  test("een album waarin alles gezien is, krijgt de laatste toevoeging als lastSeenAt", () => {
    const { records } = runProd();
    const row = bySource(records.albumLastSeen, "U-bob#A-1");
    expect(row.lastSeenAt).toBe(day("2021-04-06"));
  });

  test("een album zonder foto's krijgt geen record — de fallback in albums.ts regelt dat", () => {
    const { records } = runProd();
    const keys = records.albumLastSeen.map((r: Row) => r.albumId);
    expect(keys).not.toContain("A-2");
  });

  test("een entry naar een niet-bestaande foto wordt overgeslagen en gemeld", () => {
    const { records, warnings } = runProd();
    expect(records.albumLastSeen.every((r: Row) => r.userId && r.albumId)).toBe(true);
    expect(warnings.some((w: string) => /P-ghost/.test(w))).toBe(true);
  });

  test("er is hooguit één record per (user, album)", () => {
    const { records } = runProd();
    const keys = records.albumLastSeen.map((r: Row) => `${r.userId}#${r.albumId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Referentiële integriteit — in beide configuraties
// ────────────────────────────────────────────────────────────────────────
// De FK's komen uit de handmatige oracle in `fkOracle.ts` en bewust niet uit
// `FKS` in scripts/migrate/types.ts: `transform.ts` gebruikt die lijst zélf voor
// zijn slotcontrole. Zou deze test hem importeren, dan controleerde hij de
// transform met het materiaal van de transform (WP12 fix-cyclus 2, R2-3). De
// oracle staat buiten beide en wordt in `sharedLists.test.ts` aan monitoring.ts
// en aan de tooling vastgeklonken.
const REQUIRED_FKS: Array<[string, string, string]> = REQUIRED_FK_ORACLE.map((fk) => [
  fk.table,
  fk.field,
  fk.target,
]);

const OPTIONAL_FKS: Array<[string, string, string]> = OPTIONAL_FK_ORACLE.map((fk) => [
  fk.table,
  fk.field,
  fk.target,
]);

function assertClosed(records: Record<string, Row[]>) {
  const keysOf = (table: string) => new Set((records[table] ?? []).map((r) => r.sourceKey));
  for (const [table, field, target] of REQUIRED_FKS) {
    for (const row of records[table] ?? []) {
      expect(row[field], `${table}.${field} van ${row.sourceKey} ontbreekt`).toBeDefined();
      expect(
        keysOf(target).has(row[field]),
        `${table}.${field}=${row[field]} (${row.sourceKey}) resolvet niet in ${target}`,
      ).toBe(true);
    }
  }
  for (const [table, field, target] of OPTIONAL_FKS) {
    for (const row of records[table] ?? []) {
      if (row[field] === undefined) continue;
      expect(
        keysOf(target).has(row[field]),
        `${table}.${field}=${row[field]} (${row.sourceKey}) is gezet maar resolvet niet in ${target}`,
      ).toBe(true);
    }
  }
}

describe("referentiële integriteit", () => {
  test("prod-output is referentieel gesloten", () => {
    assertClosed(runProd().records);
  });

  test("dev-output is referentieel gesloten, ondanks het filter", () => {
    // Dit is de scherpste eis op de dev-filter: G-2 is gesticht door een
    // niet-chosen user, en G-3's cover-foto is van een niet-chosen eigenaar.
    // Welke oplossing gekozen wordt (groep uitsluiten, founder meenemen,
    // optionele FK wissen) staat vrij — dangling FK's zijn dat niet, want
    // die worden vanaf dag één dagelijks door WP10 gerapporteerd.
    assertClosed(runDev().records);
  });

  test("elke user in de output heeft een subject uit de ID-map", () => {
    const { records } = runDev();
    for (const u of records.users as Row[]) {
      expect(Object.values(DEV_SUBJECTS)).toContain(u.subject);
    }
  });

  test("sourceKeys zijn uniek per tabel", () => {
    const { records } = runProd();
    for (const [table, rows] of Object.entries(records)) {
      const keys = (rows as Row[]).map((r) => r.sourceKey);
      expect(new Set(keys).size, `dubbele sourceKey in ${table}`).toBe(keys.length);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Dev-filter + anonimisatie
// ────────────────────────────────────────────────────────────────────────
describe("dev-filter", () => {
  test("de drie chosen users zitten in de output", () => {
    const { records } = runDev();
    const keys = records.users.map((u: Row) => u.sourceKey);
    for (const id of CHOSEN) expect(keys).toContain(id);
  });

  test("content van niet-chosen users komt niet mee", () => {
    const { records } = runDev();
    expect(records.photos.map((p: Row) => p.sourceKey)).not.toContain("P-dave-1");
  });

  test("een cover-foto die wegvalt wordt gewist, niet dangling gelaten", () => {
    const { records } = runDev();
    const g3 = records.groups.find((g: Row) => g.sourceKey === "G-3");
    if (g3) expect(g3.coverPhotoId).toBeUndefined();
  });

  test("een rating waarvan één kant wegvalt, valt weg", () => {
    const { records } = runDev();
    const userKeys = new Set(records.users.map((u: Row) => u.sourceKey));
    const photoKeys = new Set(records.photos.map((p: Row) => p.sourceKey));
    for (const r of records.ratings as Row[]) {
      expect(userKeys.has(r.userId)).toBe(true);
      expect(photoKeys.has(r.photoId)).toBe(true);
    }
  });

  test("prod filtert niet: alle vier de users komen mee", () => {
    const { records } = runProd();
    expect(records.users.map((u: Row) => u.sourceKey).sort()).toEqual([
      "U-alice",
      "U-bob",
      "U-carol",
      "U-dave",
    ]);
  });

  test("dev zonder chosen users is een configuratiefout, geen stille volledige export", () => {
    expect(() => transform(buildExtract(), { ...devConfig, chosenUserIds: null })).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix-cyclus 1, S-2 — de geratificeerde dev-invite-filterregel
//
// Het plan zei "invites: alleen tussen de 3 chosen". Onhoudbaar: een invite aan
// iemand zónder account is juist het normale geval, en die persoon kán geen
// chosen user zijn — met die lezing bevat de dev-seed nul invites en is de
// invite-flow er niet op te testen. Regie ratificeerde de drie clausules
// hieronder; deze tests pinnen ze, zodat de regel niet nog eens ongemerkt
// verschuift.
// ────────────────────────────────────────────────────────────────────────
describe("dev-filter: invites", () => {
  test("een invite aan een adres zónder account blijft staan", () => {
    const { records } = runDev();
    expect(records.invites.length).toBeGreaterThan(0);
    // De uitnodiger is de enige verplichte FK; die moet chosen zijn.
    for (const i of records.invites as Row[]) {
      expect(CHOSEN).toContain(i.invitedBy);
    }
  });

  test("een invite van een niet-chosen uitnodiger valt weg", () => {
    const { records } = runDev();
    expect(records.invites.map((i: Row) => i.invitedBy)).not.toContain("U-dave");
  });

  test("een invite aan een bestaande, niet-chosen user valt weg", () => {
    const { records } = runDev();
    expect(records.invites.map((i: Row) => i.sourceKey)).not.toContain("U-dave#G-3");
  });

  test("een invite in een groep die niet in de dev-set zit valt weg", () => {
    const { records } = runDev();
    const groupKeys = new Set(records.groups.map((g: Row) => g.sourceKey));
    for (const i of records.invites as Row[]) {
      if (i.groupId === undefined) continue;
      expect(groupKeys.has(i.groupId)).toBe(true);
    }
  });

  test("prod filtert geen enkele invite weg", () => {
    const { records } = runProd();
    const keys = records.invites.map((i: Row) => i.sourceKey);
    expect(keys).toContain("U-dave#G-3");
    expect(keys).toContain("nieuweling@example.test#G-1");
  });

  // ──────────────────────────────────────────────────────────────────────
  // R2-4 — een invite naar een verwijderde groep. Besluit Wouter: rij
  //        behouden, groupId wissen, tellen. Dat volgt de invariant voor
  //        optionele FK's (gewist en geteld, geen uitzonderingen) en vermijdt
  //        stil dataverlies. Een groeploze invite is geen kapotte invite:
  //        accepteren levert een account zonder lidmaatschap, en dat pad
  //        bestaat sinds WP6 als zero-invite-fallback.
  // ──────────────────────────────────────────────────────────────────────
  test("een invite naar een verwijderde groep blijft bestaan, zonder groep", () => {
    const { records } = runProd();
    const invite = bySource(records.invites, "ander@example.test#G-verdwenen");
    expect(invite.groupId, "een verwijderde groep hoort gewist, niet dangling").toBeUndefined();
    // De rest van de invite blijft gewoon een bruikbare invite.
    expect(invite.invitedBy).toBe("U-alice");
    expect(invite.email).toBe("ander@example.test");
    expect(invite.token).toBeDefined();
  });

  test("het wissen wordt gemeld — stil is het niet", () => {
    const { warnings } = runProd();
    expect(warnings.some((w: string) => /G-verdwenen/.test(w))).toBe(true);
  });

  test("ook in dev blijft hij staan: de uitnodiger is chosen en de groep bestond nergens", () => {
    // De twee takken niet verwarren. "Groep bestaat niet in de bron" is een
    // bronfout en krijgt het bovenstaande gedrag; "groep is uit de dev-set
    // gefilterd" is de filter die zijn werk doet en blijft overslaan.
    const { records } = runDev();
    const invite = (records.invites as Row[]).find((i) =>
      String(i.sourceKey).endsWith("#G-verdwenen"),
    );
    expect(invite, "de invite is in dev ten onrechte overgeslagen").toBeDefined();
    expect(invite!.groupId).toBeUndefined();
  });

  test("een membership naar een verwijderde groep verdwijnt wél — groupId is daar verplicht", () => {
    // Dezelfde bronfout, andere entiteit: memberships.groupId is geen optionele
    // verwijzing, dus daar is wissen geen optie en blijft overslaan het juiste
    // gedrag.
    const { records } = runProd();
    const groupKeys = new Set(records.groups.map((g: Row) => g.sourceKey));
    for (const m of records.memberships as Row[]) {
      expect(groupKeys.has(m.groupId), `membership ${m.sourceKey} hangt aan een lege groep`).toBe(
        true,
      );
    }
  });
});

describe("anonimisatie", () => {
  // Storage-sleutels bevatten de Cognito-sub in het pad. Die zijn nodig om het
  // bestand op te halen en verdwijnen na `load-files`; ze belanden nooit in
  // Convex. Ze vallen daarom buiten de PII-scan.
  const stripStorageKeys = (records: unknown) =>
    JSON.stringify(records, (key, value) =>
      key === "storageKey" || key === "profilePhotoStorageKey" ? undefined : value,
    );

  test("geen bron-naam of bron-email komt nog voor in de dev-output", () => {
    const blob = stripStorageKeys(runDev().records);
    for (const secret of SOURCE_PII) {
      expect(blob.includes(secret), `PII lekt: ${secret}`).toBe(false);
    }
  });

  // Fix-cyclus 1, S-1. De invariant gaat over het hele bestand dat de transform
  // verlaat, niet over het records-deel ervan: de waarschuwingen worden mee
  // weggeschreven in convex-records.json en staan daarmee op dezelfde laptop.
  // Een overgeslagen invite wordt gemeld met zijn bron-sleutel, en die sleutel
  // ís een emailadres als de genodigde geen account heeft.
  test("ook het waarschuwingskanaal bevat geen bron-naam of bron-email", () => {
    const { records, warnings } = runDev();
    const blob = stripStorageKeys({ records, warnings });
    for (const secret of SOURCE_PII) {
      expect(blob.includes(secret), `PII lekt via de transform-output: ${secret}`).toBe(false);
    }
  });

  test("een overgeslagen invite blijft wél herleidbaar — anonimiseren is niet weglaten", () => {
    // De operator moet kunnen zien dát er een invite is overgeslagen en in
    // welke groep. Alleen de identiteit van de genodigde is vervangen.
    const { warnings } = runDev();
    expect(warnings.some((w: string) => /G-verdwenen/.test(w))).toBe(true);
  });

  test("ook de bron-sleutels zelf zijn geanonimiseerd — een invite-ID is een emailadres", () => {
    // De natuurlijke bron-ID van een invite naar iemand zonder account is zijn
    // emailadres (PK `UM{email}`). Die belandt dus in `sourceKey`, en daarmee
    // in `.data/convex-records.json` op de laptop. De spec-invariant is dat
    // echte adressen de transform-stap niet verlaten, niet dat ze de database
    // niet halen.
    const { records } = runDev();
    const blob = JSON.stringify(records.invites.map((i: Row) => i.sourceKey));
    expect(blob).not.toMatch(/genodigde@example\.test/);
  });

  test("de invite-token lekt het bron-adres niet, ook niet base64-gecodeerd", () => {
    // De oude token is base64 van {PK, SK} — met het emailadres in de PK.
    // Hem ongewijzigd overnemen in een dev-seed zet het echte adres alsnog in
    // het bestand, alleen minder leesbaar.
    const { records } = runDev();
    for (const i of records.invites as Row[]) {
      const decoded = Buffer.from(String(i.token), "base64").toString("utf8");
      for (const secret of SOURCE_PII) {
        expect(decoded.includes(secret), `token lekt: ${secret}`).toBe(false);
      }
    }
  });

  test("emails zijn vervangen door adressen op het test-domein", () => {
    const { records } = runDev();
    for (const u of records.users as Row[]) {
      expect(u.email).toMatch(/@clubalmanac\.test$/);
    }
    for (const i of records.invites as Row[]) {
      expect(i.email).toMatch(/@clubalmanac\.test$/);
    }
  });

  test("namen blijven gevuld — anonimiseren is niet leegmaken", () => {
    const { records } = runDev();
    for (const u of records.users as Row[]) {
      expect(typeof u.name).toBe("string");
      expect(u.name.length).toBeGreaterThan(0);
    }
  });

  test("de vervanging is stabiel en injectief: twee runs, zelfde uitkomst, geen samengevoegde users", () => {
    const first = runDev().records.users as Row[];
    const second = runDev().records.users as Row[];
    const pick = (rows: Row[]) => rows.map((u) => [u.sourceKey, u.name, u.email]).sort();
    expect(pick(first)).toEqual(pick(second));
    const emails = first.map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  test("prod anonimiseert niet: de echte naam en email blijven staan", () => {
    const { records } = runProd();
    const alice = bySource(records.users, "U-alice");
    expect(alice.name).toBe("Alice Bronwerk");
    expect(alice.email).toBe("alice.bronwerk@example.test");
  });
});
