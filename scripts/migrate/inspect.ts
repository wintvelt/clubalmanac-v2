// WP12 — stap 2: `inspect`. Overzicht per user uit het extract.
//
// Bestaat om de 3 chosen users op feiten te kiezen in plaats van uit het
// geheugen (selectiecriteria: migratie-plan §Dev seed strategie). De uitkomst
// gaat handmatig in scripts/.data/dev-config.json.
//
// Leest alleen `.data/dynamo-extract.json`; raakt AWS niet aan. De output bevat
// echte namen en adressen — hij gaat naar de terminal van de operator en nergens
// anders heen.

import { describeExtract, type ExtractFile } from "./extract.ts";
import { EXTRACT_FILE, readData } from "./paths.ts";

type UserStat = {
  userId: string;
  name: string;
  email: string;
  groups: number;
  adminIn: number;
  founderIn: number;
  photos: number;
  ratingsGiven: number;
  invitesSent: number;
};

export function inspect(): void {
  const file = readData<ExtractFile>(EXTRACT_FILE);
  console.log(`[inspect] ${describeExtract(file.meta)}`);

  const stats = new Map<string, UserStat>();
  const stat = (userId: string): UserStat => {
    const existing = stats.get(userId);
    if (existing) return existing;
    const created: UserStat = {
      userId,
      name: "",
      email: "",
      groups: 0,
      adminIn: 0,
      founderIn: 0,
      photos: 0,
      ratingsGiven: 0,
      invitesSent: 0,
    };
    stats.set(userId, created);
    return created;
  };

  const s = (value: unknown): string => (typeof value === "string" ? value : "");
  let groups = 0;
  let albums = 0;
  let albumPhotos = 0;
  let invites = 0;

  for (const item of file.items) {
    const pk = s(item.PK);
    const sk = s(item.SK);
    if (pk === "UBbase") {
      const row = stat(sk);
      row.name = s(item.name);
      row.email = s(item.email);
    } else if (pk === "GBbase") {
      groups += 1;
    } else if (pk.startsWith("GA")) {
      albums += 1;
    } else if (pk.startsWith("GP")) {
      albumPhotos += 1;
    } else if (pk.startsWith("UM")) {
      const userId = pk.slice(2);
      if (s(item.status) === "invite") {
        invites += 1;
        const from = (item.invitation as { from?: { SK?: unknown } } | undefined)?.from?.SK;
        if (typeof from === "string") stat(from).invitesSent += 1;
      } else {
        const row = stat(userId);
        row.groups += 1;
        if (s(item.role) === "admin") row.adminIn += 1;
        if (item.isFounder === true) row.founderIn += 1;
      }
    } else if (pk.startsWith("PO")) {
      stat(sk).photos += 1;
    } else if (pk.startsWith("UF")) {
      if (item.rating === 1) stat(sk).ratingsGiven += 1;
    }
  }

  const rows = [...stats.values()]
    .filter((row) => row.email !== "" || row.photos > 0)
    .sort((a, b) => b.photos - a.photos);

  console.log(
    `\n[inspect] totalen: ${rows.length} users, ${groups} groepen, ${albums} albums, ` +
      `${albumPhotos} albumfoto's, ${invites} openstaande invites\n`,
  );
  const pad = (value: string | number, width: number) => String(value).padEnd(width);
  console.log(
    pad("userId", 34) + pad("naam", 22) + pad("groepen", 9) + pad("admin", 7) +
      pad("founder", 9) + pad("foto's", 8) + pad("likes", 7) + "invites",
  );
  for (const row of rows) {
    console.log(
      pad(row.userId, 34) + pad(row.name, 22) + pad(row.groups, 9) + pad(row.adminIn, 7) +
        pad(row.founderIn, 9) + pad(row.photos, 8) + pad(row.ratingsGiven, 7) + row.invitesSent,
    );
  }
  console.log(
    `\n[inspect] kies 3 users volgens de criteria in migratie-plan-convex.md ` +
      `§Dev seed strategie: (1) founder/admin van een groep met meerdere leden, ` +
      `(2) lid van 2+ groepen, (3) veel content. Let op: een groep waarvan de ` +
      `founder niet chosen is, valt in dev volledig af.`,
  );
}
