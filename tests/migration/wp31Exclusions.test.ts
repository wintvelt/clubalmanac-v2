// WP31 — RED tests: wat bewust niet meegaat naar prod (spec §Blokkers B2,
// invariant 11, besluit W5).
//
// Aanleiding: op prod eist de transform een Clerk-ID voor élke user. Het
// reviewaccount van Apple uit v1 krijgt er geen, dus zonder uitsluiting stopt de
// prod-run. Daarnaast moet de herinnering in de oude app (een album in een
// bestaande groep, W2) buiten de migratie blijven, en de testgroep van het
// reviewaccount ook.
//
// Gedrag dat hier vastligt:
//   - drie lijsten in de config, met bron-ID's: users, groepen, albums;
//   - alles wat aan een uitgesloten ID hangt valt mee weg, en niets in de
//     uitvoer verwijst er nog naar;
//   - wat niet aan een uitgesloten ID hangt, blijft precies zoals zonder
//     uitsluiting (ook foto's van een gewoon lid in een uitgesloten groep);
//   - een ID die niet in het extract staat stopt de run (typfout), net als een
//     uitgesloten user die oprichter is van een groep die wél meegaat;
//   - het rapport noemt elke uitgesloten ID.
//
// De fixture bouwt voort op de gedeelde `buildExtract` (synthetisch, zie
// fixture.ts) zonder die te wijzigen: andere suites tellen erop.

import { describe, expect, test } from "vitest";
import { referencedStorageKeys } from "../../scripts/migrate/loadFiles";
import type { RecordsFile } from "../../scripts/migrate/runTransform";
import { transform, type TransformConfig } from "../../scripts/migrate/transform";
import type { Records, Row, SourceItem, TableName } from "../../scripts/migrate/types";
import { TABLE_ORDER } from "../../scripts/migrate/types";
import { ALICE, BOB, buildExtract, day, PROD_SUBJECTS } from "./fixture";

const NOW = day("2026-08-23");

const PROD: TransformConfig = {
  target: "prod",
  chosenUserIds: null,
  anonymize: false,
  subjectByUserId: PROD_SUBJECTS, // bewust zonder U-erin: zij krijgt geen Clerk-account
  defaultPhotoLimit: 1000,
  now: NOW,
};

type Exclusions = { excludeUserIds?: string[]; excludeGroupIds?: string[]; excludeAlbumIds?: string[] };

/** De config-velden bestaan nog niet; `as` houdt de typecheck stil tot B ze toevoegt. */
const withExclusions = (exclusions: Exclusions): TransformConfig =>
  ({ ...PROD, ...exclusions }) as TransformConfig;

const ALL: Exclusions = {
  excludeUserIds: ["U-erin"],
  excludeGroupIds: ["G-test"],
  excludeAlbumIds: ["A-cut"],
};

// Erin: het reviewaccount. Lid van haar testgroep en van G-1, publiceert in
// beide, is cover van een album in G-1, meldde een foto, nodigde iemand uit,
// diende een idee in en likete een foto.
const ERIN = {
  PK: "UBbase",
  SK: "U-erin",
  name: "Erin Bronwerk",
  email: "erin@example.test",
  photoUrl: "protected/sub-erin/avatar.jpg",
  createdAt: "2023-01-31",
};

function buildExtractWithExclusions(): SourceItem[] {
  return [
    ...buildExtract(),

    // ── reviewaccount ─────────────────────────────────────────────────
    ERIN,
    { PK: "UPstats", SK: "U-erin", photoCount: 2, createdAt: "2023-01-31" },
    { PK: "UVvisit", SK: "U-erin", visitDateLast: "2023-08-12", createdAt: "2023-01-31" },

    // ── testgroep (uitgesloten): oprichter Alice, Erin is lid ──────────
    { PK: "GBbase", SK: "G-test", name: "Testgroep", photoId: "P-erin-1", createdAt: "2023-01-31" },
    { PK: "UMU-alice", SK: "G-test", role: "admin", isFounder: true, user: ALICE, createdAt: "2023-01-31" },
    {
      PK: "UMU-erin",
      SK: "G-test",
      role: "admin",
      status: "active",
      user: ERIN,
      createdAt: "2023-01-31",
      seenPics: [{ albumId: "A-test", photoId: "P-alice-t" }],
    },
    { PK: "GAG-test", SK: "A-test", name: "Honden", photoId: "P-erin-1", createdAt: "2023-02-01" },
    { PK: "GPG-test#A-test", SK: "P-erin-1", photo: { SK: "U-erin", user: ERIN }, createdAt: "2023-02-01" },
    { PK: "GPG-test#A-test", SK: "P-alice-t", photo: { SK: "U-alice", user: ALICE }, createdAt: "2023-02-02" },
    {
      PK: "UMtest@example.test",
      SK: "G-test",
      status: "invite",
      role: "guest",
      user: { name: "Test Bronwerk", email: "test@example.test" },
      invitation: { from: ALICE, message: "Doe mee" },
      createdAt: "2026-08-20",
    },

    // ── Erin in een groep die wél meegaat ─────────────────────────────
    {
      PK: "UMU-erin",
      SK: "G-1",
      role: "guest",
      status: "active",
      user: ERIN,
      createdAt: "2023-02-03",
      seenPics: [{ albumId: "A-1", photoId: "P-bob-1", seenDate: "2023-03-01" }],
    },
    { PK: "GPG-1#A-1", SK: "P-erin-2", photo: { SK: "U-erin", user: ERIN }, createdAt: "2023-02-04" },
    { PK: "GAG-1", SK: "A-e", name: "Erins cover", photoId: "P-erin-2", createdAt: "2023-02-05" },
    {
      PK: "UMvriend@example.test",
      SK: "G-1",
      status: "invite",
      role: "guest",
      user: { name: "Vriend Bronwerk", email: "vriend@example.test" },
      invitation: { from: ERIN, message: "Kijk eens" },
      createdAt: "2026-08-20",
    },
    {
      PK: "NFfeature",
      SK: "F-e",
      title: "Testidee",
      description: "Van het reviewaccount",
      status: "submitted",
      votes: 1,
      userId: "U-erin",
      user: ERIN,
      createdAt: "2023-03-01",
    },
    { PK: "UFP-bob-1", SK: "U-erin", rating: 1, prevRating: 0, createdAt: "2023-03-02" },

    // ── foto's ────────────────────────────────────────────────────────
    { PK: "POP-erin-1", SK: "U-erin", url: "protected/sub-erin/e1.jpg", user: ERIN, createdAt: "2023-02-01" },
    { PK: "POP-erin-2", SK: "U-erin", url: "protected/sub-erin/e2.jpg", user: ERIN, createdAt: "2023-02-04" },
    // Alice' foto staat alleen in de uitgesloten testgroep: hij hoort bij Alice
    // en gaat mee (Mijn foto's), alleen de publicatie valt weg.
    { PK: "POP-alice-t", SK: "U-alice", url: "protected/U-alice-sub/test.jpg", user: ALICE, createdAt: "2023-02-02" },
    // Een foto van Alice die Erin meldde (zonder verwijderdatum).
    {
      PK: "POP-alice-3",
      SK: "U-alice",
      url: "protected/U-alice-sub/gemeld.jpg",
      user: ALICE,
      flagged: "flagged",
      flaggedBy: "U-erin",
      flaggedDate: "2023-04-01",
      flaggedDeleteDate: "",
      createdAt: "2023-03-05",
    },

    // ── herinnering in de oude app (W2): album in G-1, met een publicatie
    //    van een foto die ook elders staat ───────────────────────────────
    {
      PK: "GAG-1",
      SK: "A-cut",
      name: "Nieuwe app op 1 december",
      photo: { url: "public/img/cutover.jpg" },
      sortDate: "9999-12-31",
      createdAt: "2026-11-20",
    },
    { PK: "GPG-1#A-cut", SK: "P-bob-1", photo: { SK: "U-bob", user: BOB }, createdAt: "2026-11-20" },
  ];
}

const keysOf = (rows: Row[]): string[] => rows.map((r) => r.sourceKey).sort();

/** Alle bron-ID's en kenmerken van wat uitgesloten is. */
const EXCLUDED_MARKERS = [
  "U-erin",
  "G-test",
  "A-test",
  "A-cut",
  "P-erin-1",
  "P-erin-2",
  "F-e",
  "Erin Bronwerk",
  "erin@example.test",
  "vriend@example.test",
  "test@example.test",
  "sub-erin",
  "public/img/cutover.jpg",
];

const recordsFile = (records: Records): RecordsFile =>
  ({
    meta: { transformedAt: "", target: "prod", source: {}, counts: {} },
    records,
    warnings: [],
  }) as unknown as RecordsFile;

describe("WP31 W5: zonder uitsluiting stopt de prod-run", () => {
  test("het reviewaccount heeft geen Clerk-ID, dus de transform weigert", () => {
    expect(() => transform(buildExtractWithExclusions(), PROD)).toThrow(/U-erin/);
  });
});

describe("WP31 invariant 11: uitsluiten via de config", () => {
  const run = () => transform(buildExtractWithExclusions(), withExclusions(ALL));

  test("met de drie lijsten slaagt de prod-run", () => {
    expect(run).not.toThrow();
  });

  test("niets in de uitvoer verwijst nog naar iets wat uitgesloten is", () => {
    const { records } = run();
    const out = JSON.stringify(records);
    for (const marker of EXCLUDED_MARKERS) {
      expect(out, `uitvoer bevat nog '${marker}'`).not.toContain(marker);
    }
  });

  test("load-files uploadt geen bestand van een uitgesloten user", () => {
    const { records } = run();
    const keys = referencedStorageKeys(recordsFile(records));
    expect(keys.filter((k) => k.includes("sub-erin"))).toEqual([]);
  });

  test("de rest is precies wat er zonder de toevoegingen zou zijn, plus wat bij een gewoon lid hoort", () => {
    // Referentie: de gedeelde fixture zonder reviewaccount en zonder
    // herinnering, op dezelfde prod-config.
    const baseline = transform(buildExtract(), PROD).records;
    const { records } = run();

    // Wat er nieuw bij hoort: Alice' foto uit de testgroep en haar gemelde
    // foto (allebei van een gewoon lid), en het album in G-1 waarvan de cover
    // een foto van het reviewaccount was (het album gaat mee, zonder cover).
    const added: Partial<Record<TableName, string[]>> = {
      photos: ["P-alice-3", "P-alice-t"],
      albums: ["A-e"],
    };
    for (const table of TABLE_ORDER) {
      const expected = [...keysOf(baseline[table]), ...(added[table] ?? [])].sort();
      expect(keysOf(records[table]), `tabel ${table}`).toEqual(expected);
    }
  });

  test("een album dat meegaat verliest alleen een cover die uitgesloten is", () => {
    const { records } = run();
    const album = records.albums.find((r) => r.sourceKey === "A-e");
    expect(album?.groupId).toBe("G-1");
    expect(album?.coverPhotoId).toBeUndefined();
  });

  test("een foto die meegaat verliest alleen een melder die uitgesloten is", () => {
    const { records } = run();
    const photo = records.photos.find((r) => r.sourceKey === "P-alice-3");
    expect(photo?.ownerId).toBe("U-alice");
    expect(photo?.flaggedBy).toBeUndefined();
  });

  test("het rapport noemt elke uitgesloten ID", () => {
    const { warnings } = run();
    for (const id of ["U-erin", "G-test", "A-cut"]) {
      expect(
        warnings.some((w) => w.includes(id)),
        `geen melding over ${id}`,
      ).toBe(true);
    }
  });

  test("elke lijst werkt ook los: alleen het album uitsluiten laat de rest staan", () => {
    // Zonder reviewaccount in het extract, zodat alleen de albumlijst telt.
    const items = buildExtract().concat([
      {
        PK: "GAG-1",
        SK: "A-cut",
        name: "Nieuwe app op 1 december",
        photo: { url: "public/img/cutover.jpg" },
        createdAt: "2026-11-20",
      },
      { PK: "GPG-1#A-cut", SK: "P-bob-1", photo: { SK: "U-bob", user: BOB }, createdAt: "2026-11-20" },
    ]);
    const baseline = transform(buildExtract(), PROD).records;
    const { records } = transform(items, withExclusions({ excludeAlbumIds: ["A-cut"] }));
    for (const table of TABLE_ORDER) {
      expect(keysOf(records[table]), `tabel ${table}`).toEqual(keysOf(baseline[table]));
    }
    // De foto uit het uitgesloten album blijft, in zijn andere album.
    expect(records.albumPhotos.some((r) => r.photoId === "P-bob-1" && r.albumId === "A-1")).toBe(true);
  });
});

describe("WP31 invariant 11: fouten in de uitsluiting stoppen de run", () => {
  test.each([
    ["user", { ...ALL, excludeUserIds: ["U-erin", "U-onbekend"] }, /U-onbekend/],
    ["groep", { ...ALL, excludeGroupIds: ["G-test", "G-onbekend"] }, /G-onbekend/],
    ["album", { ...ALL, excludeAlbumIds: ["A-cut", "A-onbekend"] }, /A-onbekend/],
  ])("een %s-ID die niet in het extract staat", (_soort, exclusions, message) => {
    expect(() => transform(buildExtractWithExclusions(), withExclusions(exclusions))).toThrow(message);
  });

  test("een uitgesloten user die oprichter is van een groep die meegaat", () => {
    // Alice richtte G-1 op; G-1 gaat mee. Dan is groups.createdBy niet in te vullen.
    const exclusions = { ...ALL, excludeUserIds: ["U-erin", "U-alice"] };
    expect(() => transform(buildExtractWithExclusions(), withExclusions(exclusions))).toThrow(/U-alice/);
  });
});

// ── WP31 fix-ronde audit (A, 2026-11-16) ─────────────────────────────
//
// N2: een uitnodiging *aan* het adres van een uitgesloten user. Zonder account
// heeft zo'n uitnodiging het adres als sleutel (`UM{email}`), geen user-ID. Ze
// hoort net zo weg te vallen als een uitnodiging aan de user zelf: anders kan
// het reviewaccount na T0 met dat adres een groep van leden in (invariant 3).
// En ze telt mee in de rapportregel van die user (invariant 11).
//
// S4: elke rapportregel noemt naast de ID ook de naam uit de bron. De config
// bevat alleen ID's; twee groepen met bijna dezelfde naam zijn met de hand
// makkelijk te verwisselen.

/** Uitnodiging in G-1 (gaat mee), van Alice, aan een adres zonder account. */
const addressInvite = (key: string, nestedEmail: string): SourceItem => ({
  PK: `UM${key}`,
  SK: "G-1",
  status: "invite",
  role: "guest",
  user: { name: "Erin Bronwerk", email: nestedEmail },
  invitation: { from: ALICE, message: "Kom erbij" },
  createdAt: "2026-08-21",
});

const lineAbout = (warnings: string[], id: string): string => {
  const lines = warnings.filter((w) => w.includes(id) && w.includes("uitgesloten"));
  expect(lines, `rapportregel over ${id}`).toHaveLength(1);
  return lines[0]!;
};

describe("WP31 N2: een uitnodiging aan het adres van een uitgesloten user valt weg", () => {
  const baseline = () => transform(buildExtractWithExclusions(), withExclusions(ALL));

  test.each([
    ["zelfde schrijfwijze", "erin@example.test", "erin@example.test"],
    ["andere hoofdletters in de sleutel", "Erin@Example.TEST", "Erin@Example.TEST"],
  ])("%s: geen uitnodiging erbij, de rest gelijk", (_naam, key, nested) => {
    const items = [...buildExtractWithExclusions(), addressInvite(key, nested)];
    const { records } = transform(items, withExclusions(ALL));
    expect(JSON.stringify(records.invites).toLowerCase()).not.toContain("erin@example.test");
    for (const table of TABLE_ORDER) {
      expect(keysOf(records[table]), `tabel ${table}`).toEqual(keysOf(baseline().records[table]));
    }
  });

  test("de rapportregel van de user telt die uitnodiging mee", () => {
    const before = lineAbout(baseline().warnings, "U-erin");
    const items = [...buildExtractWithExclusions(), addressInvite("erin@example.test", "erin@example.test")];
    const after = lineAbout(transform(items, withExclusions(ALL)).warnings, "U-erin");
    // Zonder: 1 (Erin nodigde Vriend uit). Met: 2.
    expect(before).toMatch(/\b1 uitnodiging/);
    expect(after).toMatch(/\b2 uitnodiging/);
  });

  test("ook als alleen het adres in de uitnodiging van Erin is (sleutel een oud adres): weg én geteld", () => {
    // `user.email` is leidend boven de sleutel (transform.ts). Wat op dat adres
    // wegvalt, hoort ook in de telling van de user.
    const items = [...buildExtractWithExclusions(), addressInvite("oud-adres@example.test", "erin@example.test")];
    const { records, warnings } = transform(items, withExclusions(ALL));
    expect(JSON.stringify(records.invites)).not.toContain("erin@example.test");
    expect(lineAbout(warnings, "U-erin")).toMatch(/\b2 uitnodiging/);
  });

  test("een uitnodiging aan een ander adres blijft", () => {
    const items = [...buildExtractWithExclusions(), addressInvite("nieuw@example.test", "nieuw@example.test")];
    const { records } = transform(items, withExclusions(ALL));
    expect(records.invites.filter((r) => JSON.stringify(r).includes("nieuw@example.test"))).toHaveLength(1);
  });
});

describe("WP31 S4: de rapportregel noemt de naam bij de ID", () => {
  test("user, groep en album: ID en naam op dezelfde regel", () => {
    const { warnings } = transform(buildExtractWithExclusions(), withExclusions(ALL));
    expect(lineAbout(warnings, "U-erin")).toContain("Erin Bronwerk");
    expect(lineAbout(warnings, "G-test")).toContain("Testgroep");
    expect(lineAbout(warnings, "A-cut")).toContain("Nieuwe app op 1 december");
  });

  test("twee groepen met bijna dezelfde naam zijn in het rapport te onderscheiden", () => {
    const items = buildExtractWithExclusions().map((item) =>
      item.PK === "GBbase" && item.SK === "G-test" ? { ...item, name: "blob" } : item,
    );
    const line = lineAbout(transform(items, withExclusions(ALL)).warnings, "G-test");
    expect(line).toMatch(/"blob"/);
  });
});
