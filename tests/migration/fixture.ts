// Synthetische DynamoDB-fixture voor de WP12 transform-tests.
//
// INVARIANT (WP12 §Invarianten): testfixtures zijn synthetisch. Geen enkele
// naam, email, Cognito-sub of S3-sleutel hieronder komt uit productie. Alle
// namen zijn "<Voornaam> Bronwerk", alle adressen eindigen op `.test`
// (RFC 2606, nooit routeerbaar), alle ID's zijn leesbare labels.
//
// Vorm: één platte lijst van reeds-ge-unmarshallde DynamoDB-items, exact zoals
// `extract` ze in `.data/dynamo-extract.json` wegschrijft. PK/SK-patronen en
// attribuutnamen volgen §Bronwerkelijkheid in de WP-spec.

export type SourceItem = Record<string, unknown>;

/** Kalenderdag-string → epoch-ms op UTC-middernacht (WP12 correctie 1). */
export const day = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);

// ── Denormalisatie-hulpjes ────────────────────────────────────────────
// De oude tabel dupliceert complete user-kopieën in UM-, PO-, GP- en
// NFfeature-records. Die kopieën dragen PII en moeten dus óók door de
// anonimisatie heen (WP12 §Risico-dimensies).
const userCopy = (id: string, name: string, email: string) => ({
  PK: "UBbase",
  SK: id,
  name,
  email,
  photoUrl: `protected/${id}-sub/${id}-avatar.jpg`,
  createdAt: "2021-03-01",
});

export const ALICE = userCopy("U-alice", "Alice Bronwerk", "Alice.Bronwerk@example.test");
export const BOB = userCopy("U-bob", "Bob Bronwerk", "bob@example.test");
export const CAROL = userCopy("U-carol", "Carol Bronwerk", "carol@example.test");
export const DAVE = userCopy("U-dave", "Dave Bronwerk", "dave@example.test");

/** Alle PII-strings die onder anonimisatie nergens in de output mogen staan. */
export const SOURCE_PII = [
  "Alice Bronwerk",
  "Bob Bronwerk",
  "Carol Bronwerk",
  "Dave Bronwerk",
  "Alice.Bronwerk@example.test",
  "alice.bronwerk@example.test",
  "bob@example.test",
  "carol@example.test",
  "dave@example.test",
  "genodigde@example.test",
  "nieuweling@example.test",
  "ander@example.test",
  "Nieuweling Bronwerk",
  "Ander Bronwerk",
  "Kom je ook wandelen?",
];

export const CHOSEN = ["U-alice", "U-bob", "U-carol"];

export function buildExtract(): SourceItem[] {
  return [
    // ── users: vier records per user ──────────────────────────────────
    { ...ALICE, photoId: "P-alice-1", RK: "RND3" },
    { PK: "UPstats", SK: "U-alice", photoCount: 99, createdAt: "2021-03-01" },
    {
      PK: "UVvisit",
      SK: "U-alice",
      visitDateLast: "2026-08-01",
      visitDatePrev: "2026-07-28",
      cognitoId: "eu-central-1:aaaa-alice",
      createdAt: "2021-03-01",
    },
    // Afgeleide merge-kopie, geschreven door de stream. Géén bron — mag de
    // transform niet als tweede user opleveren (WP12 §Bronwerkelijkheid).
    {
      PK: "USER",
      SK: "U-alice",
      name: "Alice Bronwerk",
      email: "Alice.Bronwerk@example.test",
      photoId: "P-alice-1",
      createdAt: "2021-03-01",
    },

    // Bob: standaard-"knor"-profielfoto, gedeeld bestand buiten protected/.
    { ...BOB, photoUrl: "public/img/knorren/knor7.jpg", RK: "RND1" },
    { PK: "UPstats", SK: "U-bob", photoCount: 2, createdAt: "2021-03-02" },

    // Carol: profielfoto gewist → lege-string-sentinel (WP12 correctie 6).
    { ...CAROL, photoUrl: "", photoId: "", RK: "RND9" },
    { PK: "UPstats", SK: "U-carol", photoCount: 0, createdAt: "2021-03-03" },

    // Dave: niet-chosen. Founder van G-2.
    { ...DAVE, RK: "RND4" },
    { PK: "UPstats", SK: "U-dave", photoCount: 1, createdAt: "2021-03-04" },

    // ── groups ────────────────────────────────────────────────────────
    {
      PK: "GBbase",
      SK: "G-1",
      name: "Wandelgroep",
      description: "Elke zondag",
      photoId: "P-alice-1",
      photo: { PK: "PO P-alice-1", SK: "U-alice", url: "protected/U-alice-sub/vroeg.jpg" },
      createdAt: "2021-04-01",
      RK: "RND2",
    },
    { PK: "GBbase", SK: "G-2", name: "Fietsgroep", description: "", createdAt: "2021-05-01" },
    // Cover-foto van een niet-chosen eigenaar → optionele FK moet in dev
    // gewist worden, niet dangling gelaten.
    { PK: "GBbase", SK: "G-3", name: "Coverloos", photoId: "P-dave-1", createdAt: "2021-07-01" },

    // ── memberships + invites (zelfde recordtype) ─────────────────────
    // Oud record zonder `status`-veld: gewoon lid.
    {
      PK: "UMU-alice",
      SK: "G-1",
      role: "admin",
      isFounder: true,
      user: ALICE,
      createdAt: "2021-04-01",
      seenPics: [
        { albumId: "A-1", photoId: "P-bob-1", seenDate: "2026-08-01" },
        { albumId: "A-1", photoId: "P-bob-2" },
      ],
    },
    {
      PK: "UMU-bob",
      SK: "G-1",
      role: "guest",
      status: "active",
      user: BOB,
      createdAt: "2021-06-01",
      seenPics: [
        { albumId: "A-1", photoId: "P-alice-1", seenDate: "2026-08-01" },
        { albumId: "A-1", photoId: "P-ghost" },
      ],
    },
    { PK: "UMU-dave", SK: "G-2", role: "admin", isFounder: true, user: DAVE, createdAt: "2021-05-01" },
    { PK: "UMU-alice", SK: "G-2", role: "guest", status: "active", user: ALICE, createdAt: "2021-05-02" },
    { PK: "UMU-alice", SK: "G-3", role: "admin", isFounder: true, user: ALICE, createdAt: "2021-07-01" },

    // Invite naar een emailadres zonder account: PK bevat een '@'.
    {
      PK: "UMgenodigde@example.test",
      SK: "G-1",
      status: "invite",
      role: "guest",
      user: { name: "Genodigde Bronwerk", email: "genodigde@example.test" },
      invitation: { from: ALICE, message: "Kom je ook wandelen?" },
      createdAt: "2026-08-20",
    },
    // Invite naar een bestaande user, ruim over de 30 dagen heen.
    {
      PK: "UMU-carol",
      SK: "G-1",
      status: "invite",
      role: "admin",
      user: CAROL,
      invitation: { from: ALICE, message: "Kom je ook wandelen?" },
      createdAt: "2022-01-01",
    },
    // Dave (niet-chosen) is gewoon lid van G-1 en nodigt daar iemand uit.
    // Twee clausules van de dev-invite-filterregel hangen hieraan: in dev valt
    // Daves membership weg (user niet chosen) en zijn invite ook (uitnodiger
    // niet chosen), terwijl prod ze allebei houdt.
    { PK: "UMU-dave", SK: "G-1", role: "guest", status: "active", user: DAVE, createdAt: "2021-06-05" },
    {
      PK: "UMnieuweling@example.test",
      SK: "G-1",
      status: "invite",
      role: "guest",
      user: { name: "Nieuweling Bronwerk", email: "nieuweling@example.test" },
      invitation: { from: DAVE, message: "Kom je ook wandelen?" },
      createdAt: "2026-08-21",
    },
    // Derde clausule: de genodigde ís een bestaande user, maar niet chosen.
    {
      PK: "UMU-dave",
      SK: "G-3",
      status: "invite",
      role: "guest",
      user: DAVE,
      invitation: { from: ALICE, message: "Kom je ook wandelen?" },
      createdAt: "2026-08-21",
    },
    // Invite naar een adres zonder account, in een groep die niet (meer)
    // bestaat: overgeslagen record, mét waarschuwing. De bron-ID van zo'n
    // invite ís het emailadres — het meldkanaal draagt dus PII.
    {
      PK: "UMander@example.test",
      SK: "G-verdwenen",
      status: "invite",
      role: "guest",
      user: { name: "Ander Bronwerk", email: "ander@example.test" },
      invitation: { from: ALICE, message: "Kom je ook wandelen?" },
      createdAt: "2026-08-22",
    },

    // ── albums ────────────────────────────────────────────────────────
    { PK: "GAG-1", SK: "A-1", name: "Voorjaar", createdAt: "2021-04-05" },
    { PK: "GAG-1", SK: "A-2", name: "Leeg album", createdAt: "2021-04-06" },

    // ── photos ────────────────────────────────────────────────────────
    {
      PK: "POP-alice-1",
      SK: "U-alice",
      url: "protected/U-alice-sub/vroeg.jpg",
      user: ALICE,
      exifDate: "2021-04-04",
      exifLat: 52.16,
      exifLon: 4.49,
      exifAddress: "Leiden",
      rating: 2,
      createdAt: "2021-04-05",
      RK: "RND5",
      datePK: "POU-alice",
      dateSK: "2021-04-05",
    },
    {
      PK: "POP-alice-2",
      SK: "U-alice",
      url: "protected/U-alice-sub/laat.jpg",
      user: ALICE,
      flaggedDate: "2026-08-10",
      flaggedBy: "U-bob",
      flagged: "flagged",
      // Beroep aangetekend → geplande verwijdering gewist met lege string.
      flaggedDeleteDate: "",
      flaggedAppealDate: "2026-08-12",
      createdAt: "2021-04-06",
    },
    { PK: "POP-bob-1", SK: "U-bob", url: "protected/U-bob-sub/bob1.jpg", user: BOB, createdAt: "2021-04-06" },
    { PK: "POP-bob-2", SK: "U-bob", url: "protected/U-bob-sub/bob2.jpg", user: BOB, createdAt: "2021-04-06" },
    { PK: "POP-dave-1", SK: "U-dave", url: "protected/U-dave-sub/dave1.jpg", user: DAVE, createdAt: "2021-04-07" },

    // ── albumPhotos ───────────────────────────────────────────────────
    { PK: "GPG-1#A-1", SK: "P-alice-1", photo: { SK: "U-alice", user: ALICE }, createdAt: "2021-04-05" },
    { PK: "GPG-1#A-1", SK: "P-bob-1", photo: { SK: "U-bob", user: BOB }, createdAt: "2021-04-06" },
    { PK: "GPG-1#A-1", SK: "P-bob-2", photo: { SK: "U-bob", user: BOB }, createdAt: "2021-04-06" },

    // ── ratings (0/1-like, geen 1..5-score) ───────────────────────────
    { PK: "UFP-bob-1", SK: "U-alice", rating: 1, prevRating: 0, createdAt: "2021-05-01" },
    // Like weer ingetrokken → geen ratings-rij.
    { PK: "UFP-bob-2", SK: "U-alice", rating: 0, prevRating: 1, createdAt: "2021-05-02" },
    { PK: "UFP-alice-1", SK: "U-bob", rating: 1, prevRating: 0, createdAt: "2021-05-03" },
    { PK: "UFP-alice-1", SK: "U-carol", rating: 1, prevRating: 0, createdAt: "2021-05-04" },

    // ── features ──────────────────────────────────────────────────────
    {
      PK: "NFfeature",
      SK: "F-1",
      title: "Kaartweergave",
      description: "Foto's op een kaart",
      status: "submitted",
      votes: 13,
      userId: "U-alice",
      user: ALICE,
      createdAt: "2026-01-10",
    },
    {
      PK: "NFfeature",
      SK: "F-2",
      title: "Donkere modus",
      description: "Graag",
      status: "in progress",
      votes: 10,
      userId: "U-bob",
      user: BOB,
      comment: "opgepakt",
      createdAt: "2026-02-11",
    },
    {
      PK: "NFfeature",
      SK: "F-3",
      title: "Sneller laden",
      description: "Duurt lang",
      status: "completed",
      votes: 11,
      userId: "U-carol",
      user: CAROL,
      createdAt: "2026-03-12",
    },
  ];
}

export const DEV_SUBJECTS: Record<string, string> = {
  "U-alice": "user_devalice",
  "U-bob": "user_devbob",
  "U-carol": "user_devcarol",
};

export const PROD_SUBJECTS: Record<string, string> = {
  ...DEV_SUBJECTS,
  "U-dave": "user_proddave",
};
