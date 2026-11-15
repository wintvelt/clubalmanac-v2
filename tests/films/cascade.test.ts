import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { deleteAccount } from "../_helpers/deleteAccount";
import { as, newT, seedFilmsWorld, useFilmsEnv, type R, type T } from "./_films";

// WP21 fix-ronde, audit-bevinding, besluit regie: films gaan mee met hun
// groep. Cascade-matrix G3: na het verwijderen van een groep wijst niets er
// nog naar. Zowel via groups.remove (G3) als via het laatste lid dat weggaat
// (M2-e, hier via accountverwijdering). Films van een andere groep blijven.

useFilmsEnv();

async function filmRows(t: T): Promise<R[]> {
  return await t.run(async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (ctx.db as any).query("films").collect()) as R[];
  });
}

describe("G3: groep verwijderen → haar films weg", () => {
  it("groups.remove: geen film meer met die groupId; de andere groep houdt haar film", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);

    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.blob });

    const rows = await filmRows(t);
    expect(rows.filter((r) => r.groupId === w.groups.blob)).toEqual([]);
    expect(rows.filter((r) => r.groupId === w.groups.other).map((r) => r.title)).toEqual(["Andere film D"]);
  });
});

describe("M2-e: het laatste lid gaat weg → de groep en haar films weg", () => {
  it("dave (enig lid van Ander) verwijdert zijn account: geen film van Ander meer; Blob houdt de drie", async () => {
    const t = newT();
    const w = await seedFilmsWorld(t);

    await deleteAccount(t, as.dave(t));

    expect(await t.run((ctx) => ctx.db.get(w.groups.other))).toBeNull();
    const rows = await filmRows(t);
    expect(rows.filter((r) => r.groupId === w.groups.other)).toEqual([]);
    expect(rows.filter((r) => r.groupId === w.groups.blob)).toHaveLength(3);
    // De lijst van Blob werkt nog.
    expect(((await as.alice(t).query(api.films.list, {})) as R[]).map((f) => f.title)).toEqual([
      "Proef trailer A",
      "Proef film B",
      "Proef film C",
    ]);
  });
});
