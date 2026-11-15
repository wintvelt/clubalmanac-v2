import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { asUser, newT, seedWorld, useWebmasterEnv, type T } from "../readWhitelist/_world";

// WP20 A-invariant 1: titel en omschrijving worden gecontroleerd bij
// features.create en features.update. Zelfde tekenregel als namen (WP15b,
// WP28), eigen grenzen: titel 1–100 tekens op één regel, omschrijving 0–2000
// tekens met regeleinden. Fout = ConvexError met `code` (een gewone Error komt
// in productie aan als "Server Error"; de app toont de reden bij de code).
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (e) {
    if (e instanceof ConvexError) {
      const data = e.data as { code?: unknown };
      return typeof data?.code === "string" ? data.code : undefined;
    }
    return `geen ConvexError: ${String(e)}`;
  }
  return undefined;
}

async function featureCount(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("features").collect()).length);
}

async function scheduledCount(t: T) {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);
}

const ok = { type: "feature" as const, title: "Donkere modus", description: "Graag" };

describe("features.create — titel", () => {
  it.each([
    ["leeg", ""],
    ["alleen spaties", "   "],
    ["alleen vaste spatie en tab", " \t"],
  ])("%s: TITLE_REQUIRED, niets bewaard", async (_label, title) => {
    const t = newT();
    const w = await seedWorld(t);
    const before = await featureCount(t);
    expect(await codeOf(() => asUser(t, w, "bob").mutation(api.features.create, { ...ok, title }))).toBe(
      "TITLE_REQUIRED",
    );
    expect(await featureCount(t)).toBe(before);
  });

  it("101 tekens: TITLE_TOO_LONG; 100 mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    expect(await codeOf(() => bob.mutation(api.features.create, { ...ok, title: "a".repeat(101) }))).toBe(
      "TITLE_TOO_LONG",
    );
    const id = await bob.mutation(api.features.create, { ...ok, title: "a".repeat(100) });
    expect((await t.run((ctx) => ctx.db.get(id)))?.title).toBe("a".repeat(100));
  });

  it("tekens tellen als code points: 100 emoji mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const title = "🎉".repeat(100);
    const id = await asUser(t, w, "bob").mutation(api.features.create, { ...ok, title });
    expect((await t.run((ctx) => ctx.db.get(id)))?.title).toBe(title);
  });

  it.each([
    ["regeleinde", "Twee\nregels"],
    ["tab", "Met\ttab"],
    ["nulbreedte-spatie", "On​zichtbaar"],
    ["leesrichting omdraaien", "Abc‮def"],
    ["controleteken", "Bel\u0007"],
    ["zachte afbreekstreep", "Af­breek"],
  ])("%s: TITLE_INVALID, niets bewaard", async (_label, title) => {
    const t = newT();
    const w = await seedWorld(t);
    const before = await featureCount(t);
    expect(await codeOf(() => asUser(t, w, "bob").mutation(api.features.create, { ...ok, title }))).toBe(
      "TITLE_INVALID",
    );
    expect(await featureCount(t)).toBe(before);
  });

  it("emoji met ZWJ mag, en de titel wordt getrimd bewaard", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const id = await asUser(t, w, "bob").mutation(api.features.create, {
      ...ok,
      title: "  Familie 👨‍👩‍👧  ",
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.title).toBe("Familie 👨‍👩‍👧");
  });
});

describe("features.create — omschrijving", () => {
  it("leeg mag; regeleinden blijven; rand wordt getrimd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    const empty = await bob.mutation(api.features.create, { ...ok, description: "  " });
    expect((await t.run((ctx) => ctx.db.get(empty)))?.description).toBe("");
    const multi = await bob.mutation(api.features.create, {
      ...ok,
      description: "\n Eerste regel\nTweede regel \n",
    });
    expect((await t.run((ctx) => ctx.db.get(multi)))?.description).toBe("Eerste regel\nTweede regel");
  });

  it("2001 tekens: DESCRIPTION_TOO_LONG; 2000 mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    expect(
      await codeOf(() => bob.mutation(api.features.create, { ...ok, description: "b".repeat(2001) })),
    ).toBe("DESCRIPTION_TOO_LONG");
    await bob.mutation(api.features.create, { ...ok, description: "b".repeat(2000) });
  });

  it.each([
    ["nulbreedte-spatie", "On​zichtbaar"],
    ["leesrichting omdraaien", "Abc‮def"],
    ["controleteken", "Bel\u0007"],
  ])("%s: DESCRIPTION_INVALID", async (_label, description) => {
    const t = newT();
    const w = await seedWorld(t);
    expect(
      await codeOf(() => asUser(t, w, "bob").mutation(api.features.create, { ...ok, description })),
    ).toBe("DESCRIPTION_INVALID");
  });

  it("een geweigerd probleem stuurt geen mail", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const before = await scheduledCount(t);
    await codeOf(() =>
      asUser(t, w, "bob").mutation(api.features.create, { type: "problem", title: " ", description: "x" }),
    );
    expect(await scheduledCount(t)).toBe(before);
  });
});

describe("features.update — dezelfde regels", () => {
  async function setup() {
    const t = newT();
    const w = await seedWorld(t);
    return { t, w, wm: asUser(t, w, "wm"), id: w.features.fFeature as Id<"features"> };
  }

  it("lege titel, te lange titel, ongeldig teken: code, niets gewijzigd", async () => {
    const { t, wm, id } = await setup();
    const before = await t.run((ctx) => ctx.db.get(id));
    expect(await codeOf(() => wm.mutation(api.features.update, { featureId: id, title: " " }))).toBe(
      "TITLE_REQUIRED",
    );
    expect(await codeOf(() => wm.mutation(api.features.update, { featureId: id, title: "x".repeat(101) }))).toBe(
      "TITLE_TOO_LONG",
    );
    expect(await codeOf(() => wm.mutation(api.features.update, { featureId: id, title: "a​b" }))).toBe(
      "TITLE_INVALID",
    );
    expect(
      await codeOf(() => wm.mutation(api.features.update, { featureId: id, description: "d".repeat(2001) })),
    ).toBe("DESCRIPTION_TOO_LONG");
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  });

  it("geldige waarden worden getrimd bewaard", async () => {
    const { t, wm, id } = await setup();
    await wm.mutation(api.features.update, { featureId: id, title: "  Nieuw  ", description: " Tekst\nmeer " });
    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.title).toBe("Nieuw");
    expect(f?.description).toBe("Tekst\nmeer");
  });
});
