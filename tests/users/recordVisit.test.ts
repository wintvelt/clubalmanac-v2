import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { VISIT_PERIOD_MS } from "../../convex/lib/constants";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP15b invarianten 5 en 6, A-punt 1 en 2. De client roept users.recordVisit
// aan bij een terugkeer naar de app. De backend is de garantie: hoogstens één
// schrijfactie per VISIT_PERIOD_MS per user. Het bezoek staat buiten de
// users-rij: Convex draait elke query opnieuw die een gewijzigd document las,
// los van welke velden hij teruggeeft. Uitlezen kan alleen intern.

const START = new Date("2026-11-03T10:00:00Z").getTime();
const MINUTE = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const id = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  return { t, id, as: withUser(t, "user_alice") };
}

function lastVisit(t: ReturnType<typeof convexTest>, userId: Id<"users">) {
  return t.query(internal.users.getLastVisit, { userId });
}

describe("VISIT_PERIOD_MS", () => {
  it("is een uur", () => {
    expect(VISIT_PERIOD_MS).toBe(60 * MINUTE);
  });
});

describe("users.recordVisit — toegang", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.recordVisit, {})).rejects.toThrow();
  });

  it("weigert een identity zonder users-rij", async () => {
    const t = convexTest(schema, modules);
    await expect(withUser(t, "user_ghost").mutation(api.users.recordVisit, {})).rejects.toThrow();
  });
});

describe("users.getLastVisit", () => {
  it("null voor een user zonder bezoek", async () => {
    const { t, id } = await setup();
    expect(await lastVisit(t, id)).toBeNull();
  });

  it("een gemigreerde users.lastVisitAt houdt het eerste bezoek niet tegen", async () => {
    // users.lastVisitAt blijft voorlopig in het schema (open vraag 1), maar
    // recordVisit schrijft er niet meer in. Een eerste bezoek wordt gewoon
    // geregistreerd, ook als dat veld gevuld is.
    const { t, id, as } = await setup();
    await t.run((ctx) => ctx.db.patch(id, { lastVisitAt: START - 10 * MINUTE }));
    await as.mutation(api.users.recordVisit, {});
    expect(await lastVisit(t, id)).toBe(START);
  });
});

describe("users.recordVisit — throttle (invariant 5)", () => {
  it("het eerste bezoek wordt geregistreerd, met de tijd van nu", async () => {
    const { t, id, as } = await setup();
    await as.mutation(api.users.recordVisit, {});
    expect(await lastVisit(t, id)).toBe(START);
  });

  it("binnen het uur: geen nieuwe schrijfactie, geen fout", async () => {
    const { t, id, as } = await setup();
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + 59 * MINUTE);
    await expect(as.mutation(api.users.recordVisit, {})).resolves.not.toThrow();
    expect(await lastVisit(t, id)).toBe(START);
  });

  it("een client in een lus: honderd aanroepen, één bezoek", async () => {
    const { t, id, as } = await setup();
    for (let i = 0; i < 100; i++) {
      vi.setSystemTime(START + i * 1000);
      await as.mutation(api.users.recordVisit, {});
    }
    expect(await lastVisit(t, id)).toBe(START);
  });

  it("precies een uur later: wel een nieuw bezoek", async () => {
    const { t, id, as } = await setup();
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + VISIT_PERIOD_MS);
    await as.mutation(api.users.recordVisit, {});
    expect(await lastVisit(t, id)).toBe(START + VISIT_PERIOD_MS);
  });

  it("de periode telt vanaf het laatst geregistreerde bezoek, niet vanaf de laatste aanroep", async () => {
    const { t, id, as } = await setup();
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + 40 * MINUTE);
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + 61 * MINUTE);
    await as.mutation(api.users.recordVisit, {});
    expect(await lastVisit(t, id)).toBe(START + 61 * MINUTE);
  });

  it("per user: het bezoek van alice houdt dat van bob niet tegen", async () => {
    const { t, id, as } = await setup();
    const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + MINUTE);
    await withUser(t, "user_bob").mutation(api.users.recordVisit, {});
    expect(await lastVisit(t, id)).toBe(START);
    expect(await lastVisit(t, bobId)).toBe(START + MINUTE);
  });
});

describe("users.recordVisit — geen live query draait opnieuw (invariant 6)", () => {
  it("de users-rij blijft precies hetzelfde", async () => {
    const { t, id, as } = await setup();
    const before = await t.run((ctx) => ctx.db.get(id));
    await as.mutation(api.users.recordVisit, {});
    vi.setSystemTime(START + 2 * VISIT_PERIOD_MS);
    await as.mutation(api.users.recordVisit, {});
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after).toEqual(before);
  });

  it("users.current en users.profile geven hetzelfde terug, zonder lastVisitAt", async () => {
    const { as } = await setup();
    const currentBefore = await as.query(api.users.current, {});
    const profileBefore = await as.query(api.users.profile, {});
    await as.mutation(api.users.recordVisit, {});
    const currentAfter = await as.query(api.users.current, {});
    const profileAfter = await as.query(api.users.profile, {});
    expect(currentAfter).toEqual(currentBefore);
    expect(profileAfter).toEqual(profileBefore);
    expect(currentAfter).not.toHaveProperty("lastVisitAt");
    expect(profileAfter).not.toHaveProperty("lastVisitAt");
  });
});

describe("users.deleteSelf ruimt het bezoek op (cascade U11)", () => {
  it("na het verwijderen is er geen bezoek meer", async () => {
    const { t, id, as } = await setup();
    await as.mutation(api.users.recordVisit, {});
    await as.mutation(api.users.deleteSelf, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await lastVisit(t, id)).toBeNull();
  });

  it("het bezoek van een ander blijft staan", async () => {
    const { t, as } = await setup();
    const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
    await withUser(t, "user_bob").mutation(api.users.recordVisit, {});
    await as.mutation(api.users.recordVisit, {});
    await as.mutation(api.users.deleteSelf, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await lastVisit(t, bobId)).toBe(START);
  });
});
