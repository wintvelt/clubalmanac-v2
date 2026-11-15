import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  as,
  asGhost,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
} from "../writeGates/_helpers";
import { WEBMASTER_EMAIL } from "../readWhitelist/_world";

// WP20 A-invariant 2: de webmaster zet de status van een idee of probleem
// met features.setStatus. Alleen de status verandert. Invariant 3: een
// niet-webmaster krijgt dezelfde weigering voor een bestaand en een onbekend
// id, en er verandert niets.
// Spec: docs/work-packages/WP20-melden.md §A-invarianten.

useWebmasterEnv();

type Status = "open" | "planned" | "inProgress" | "done" | "rejected";
const setStatus = makeFunctionReference<
  "mutation",
  { featureId: Id<"features">; status: Status },
  null
>("features:setStatus");

const STATUSES: Status[] = ["planned", "inProgress", "done", "rejected", "open"];

describe("features.setStatus — webmaster", () => {
  it("zet elke status, op een idee en op een probleem; verder verandert niets", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const wm = asUser(t, w, "wm");
    for (const featureId of [w.features.fFeature, w.features.fCarolProblem]) {
      const before = await t.run((ctx) => ctx.db.get(featureId));
      for (const status of STATUSES) {
        await wm.mutation(setStatus, { featureId, status });
        const after = await t.run((ctx) => ctx.db.get(featureId));
        expect(after).toEqual({ ...before, status });
      }
    }
  });

  it("een lid ziet de nieuwe status in de lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "wm").mutation(setStatus, { featureId: w.features.fFeature, status: "done" });
    const list = await asUser(t, w, "alice").query(api.features.list, {});
    expect(list.find((f) => f._id === w.features.fFeature)?.status).toBe("done");
  });

  it("onbekend id: geweigerd, niets gewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "features");
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "wm").mutation(setStatus, { featureId: missing, status: "done" }),
    );
  });
});

describe("features.setStatus — niet de webmaster", () => {
  it("uitgelogd en identity zonder users-rij: geweigerd, niets gewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { featureId: w.features.fFeature, status: "done" as const };
    await expectRejectedNoChange(t, () => t.mutation(setStatus, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(setStatus, args), "ghost");
    await expectRejectedNoChange(
      t,
      () => as(t, "user_wm_ghost", WEBMASTER_EMAIL).mutation(setStatus, args),
      "webmaster-adres zonder users-rij",
    );
  });

  it("de indiener zelf: geweigerd (eigen idee en eigen probleem)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    for (const featureId of [w.features.fFeature, w.features.fBobProblem]) {
      await expectRejectedNoChange(t, () => bob.mutation(setStatus, { featureId, status: "done" }));
    }
  });

  it("bestaand en onbekend id geven dezelfde weigering (invariant 3)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "features");
    const alice = asUser(t, w, "alice");
    await expectNoMutationOracle(
      t,
      () => alice.mutation(setStatus, { featureId: missing, status: "done" }),
      () => alice.mutation(setStatus, { featureId: w.features.fFeature, status: "done" }),
    );
    await expectNoMutationOracle(
      t,
      () => alice.mutation(setStatus, { featureId: missing, status: "done" }),
      () => alice.mutation(setStatus, { featureId: w.features.fCarolProblem, status: "done" }),
    );
  });
});
