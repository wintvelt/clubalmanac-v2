import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { assertReactive } from "../_helpers/reactive";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoUserSecrets,
  expectShape,
  newT,
  seedWorld,
  useWebmasterEnv,
  type R,
} from "../readWhitelist/_world";

// WP15b invariant 7, A-punt 1: Profiel heeft een eigen live query. Het is een
// andere functie dan users.current (de poort), zodat Convex de abonnementen
// niet samenvoegt en de tabwissel meetbaar is. Zelfde vorm als users.current
// (WP23 ownProfile), zonder lastVisitAt.

useWebmasterEnv();

describe("users.profile", () => {
  it("is een andere functie dan users.current", () => {
    expect(api.users.profile).toBeDefined();
    expect(api.users.profile).not.toBe(api.users.current);
  });

  it("null zonder identity en null bij een identity zonder users-rij", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(api.users.profile, {})).toBeNull();
    expect(await asGhost(t).query(api.users.profile, {})).toBeNull();
  });

  it("geeft precies de eigen-profiel-velden, zonder lastVisitAt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const me = (await asUser(t, w, "alice").query(api.users.profile, {})) as R;
    expectShape(me, SHAPE.ownProfile);
    expect(me).not.toHaveProperty("lastVisitAt");
    expect(me._id).toBe(w.users.alice.id);
    expect(me.email).toBe("alice@x.com");
    expect(me.name).toBe("Alice");
    expectNoUserSecrets(me, w, { allowEmail: "alice@x.com" });
  });

  it("geeft hetzelfde als users.current", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const as = asUser(t, w, "alice");
    expect(await as.query(api.users.profile, {})).toEqual(await as.query(api.users.current, {}));
  });

  it("toont een nieuwe naam direct na updateProfile", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const as = asUser(t, w, "alice");
    const { before, after } = await assertReactive(
      () => as.query(api.users.profile, {}),
      () => as.mutation(api.users.updateProfile, { name: " Alice 2 " }),
    );
    expect(before?.name).toBe("Alice");
    expect(after?.name).toBe("Alice 2");
  });
});
