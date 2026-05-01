import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// FL2 — photos.decideFlag mutation. Bron: oude AWS handler
// blob-images-api-photos/handlersPhoto/flagPhotoDecide.js (regel 58-137):
//   - webmaster only (regel 60-61, oude env-var webmasterId; v2: requireWebmaster)
//   - vereist al-geflagde + al-geappealde state (regel 76-77)
//   - decision=true (approve): clear alle flag-velden (regel 84-90)
//   - decision=false (deny): set flaggedAppealDenyDate + flaggedDeleteDate=now+7d
//     (regel 113-117 in oude code, DENY_DAYS=7 op regel 11)
//   - email naar owner (regel 126-136), zowel approve als deny
//
// In v2: email-template volgt in apart email-werkpakket. decideFlag mutation
// queue't internal.photos.sendFlagDecisionEmail action via scheduler.
// Per cascade-matrix FL2: "assert: email-action gequeue'd bij deny, niet bij approve".
// Wij volgen die regel — old code stuurde altijd een mail, in v2 alleen bij deny
// (= afwijking, expliciet vastgelegd in cascade-matrix).

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const DENY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEBMASTER_EMAIL = "webmaster@x.com";

function withUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email?: string,
) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
) {
  // Audit-7 §5: seed pending invite om users.register-gate te passeren.
  const { inviteId, seederId } = await t.run(async (ctx) => {
    const seederId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: seederId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
  const userId = await withUser(t, subject, email).mutation(api.users.register, { email });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

async function uploadStorage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

async function appealedPhoto(t: ReturnType<typeof convexTest>) {
  // alice (owner), bob (flagger). alice appealt.
  await registerUser(t, "user_alice", "a@x.com");
  await registerUser(t, "user_bob", "b@x.com");
  const storageId = await uploadStorage(t);
  const photoId = await withUser(t, "user_alice").mutation(api.photos.create, {
    storageId,
  });
  await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });
  await withUser(t, "user_alice").mutation(api.photos.appeal, { photoId });
  return photoId;
}

describe("photos.decideFlag — webmaster only", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // flagPhotoDecide.js regel 60-61: only webmaster
  it("non-webmaster kan niet beslissen", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);

    await expect(
      withUser(t, "user_bob", "b@x.com").mutation(api.photos.decideFlag, {
        photoId,
        approve: true,
      }),
    ).rejects.toThrow();
  });

  it("webmaster kan beslissen", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    await expect(
      withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
        api.photos.decideFlag,
        { photoId, approve: true },
      ),
    ).resolves.not.toThrow();
  });
});

describe("photos.decideFlag — approve", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // flagPhotoDecide.js regel 84-90: clear alle flag-velden
  it("approve clear alle flag-velden", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: true },
    );

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo).not.toBeNull();
    expect(photo?.flaggedAt).toBeUndefined();
    expect(photo?.flaggedBy).toBeUndefined();
    expect(photo?.flagReason).toBeUndefined();
    expect(photo?.flaggedDeleteDate).toBeUndefined();
    expect(photo?.flaggedAppealDate).toBeUndefined();
    expect(photo?.flaggedAppealDenyDate).toBeUndefined();
  });

  // FL2 cascade-matrix: alleen bij deny email — afwijking van oude code
  it("approve queue't GEEN sendFlagDecisionEmail action", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    const before = await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).length,
    );
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: true },
    );
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailEntries = scheduled.filter((s) =>
      s.name.includes("sendFlagDecisionEmail"),
    );
    expect(emailEntries).toHaveLength(0);
    void before;
  });
});

describe("photos.decideFlag — deny", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // flagPhotoDecide.js regel 113-117: deny → flaggedAppealDenyDate + flaggedDeleteDate=now+7d
  it("deny zet flaggedAppealDenyDate en herstart 7d countdown", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    const before = Date.now();
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: false },
    );
    const after = Date.now();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(typeof photo?.flaggedAppealDenyDate).toBe("number");
    expect(photo?.flaggedAppealDenyDate).toBeGreaterThanOrEqual(before);
    expect(photo?.flaggedAppealDenyDate).toBeLessThanOrEqual(after);

    expect(typeof photo?.flaggedDeleteDate).toBe("number");
    const expected =
      (photo!.flaggedAppealDenyDate as number) + DENY_DAYS * DAY_MS;
    expect(
      Math.abs((photo!.flaggedDeleteDate as number) - expected),
    ).toBeLessThan(60_000);

    // origineel flag intact (foto wordt nog niet meteen verwijderd)
    expect(typeof photo?.flaggedAt).toBe("number");
    expect(photo?.flaggedAppealDate).toBeDefined();
  });

  it("deny queue't sendFlagDecisionEmail action", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: false },
    );

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailEntries = scheduled.filter((s) =>
      s.name.includes("sendFlagDecisionEmail"),
    );
    expect(emailEntries.length).toBeGreaterThan(0);
  });
});

describe("photos.decideFlag — re-decision na deny (audit-9 §2)", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // Audit-9 §2 design-keuze: webmaster mag eigen deny overrulen door
  // alsnog approve te beslissen. Niet idempotent gemaakt — bewust permissief
  // voor menselijke fout-correctie. Approve-pad cleart alle velden, ongeacht
  // huidige staat (behalve dat er een appeal moet zijn — die blijft gezet
  // ook na deny, dus de guard op flaggedAppealDate passeert).
  it("decideFlag(approve) na deny: webmaster overrulet eigen deny, alle velden gewist", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    // Eerste call: deny.
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: false },
    );
    const afterDeny = await t.run((ctx) => ctx.db.get(photoId));
    expect(typeof afterDeny?.flaggedAppealDenyDate).toBe("number");

    // Tweede call: approve — overrulet de deny.
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: true },
    );

    const after = await t.run((ctx) => ctx.db.get(photoId));
    expect(after).not.toBeNull();
    expect(after?.flaggedAt).toBeUndefined();
    expect(after?.flaggedBy).toBeUndefined();
    expect(after?.flagReason).toBeUndefined();
    expect(after?.flaggedDeleteDate).toBeUndefined();
    expect(after?.flaggedAppealDate).toBeUndefined();
    expect(after?.flaggedAppealDenyDate).toBeUndefined();
  });

  // Audit-9 §2 design-keuze: deny-na-deny is idempotent. Anders kan een
  // accidental dubbel-click owner een tweede mail bezorgen én de 7d
  // countdown verlengen tot effectief 14d. Gewenst gedrag: tweede call
  // is no-op — flaggedDeleteDate ongewijzigd, geen extra email-action.
  // RED tot B's idempotency-fix in decideFlag landt.
  it("decideFlag(deny) na deny: idempotent (geen extra email, geen countdown reset)", async () => {
    const t = convexTest(schema);
    const photoId = await appealedPhoto(t);
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    // Eerste deny.
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: false },
    );
    const afterFirst = await t.run((ctx) => ctx.db.get(photoId));
    const firstDenyDate = afterFirst?.flaggedAppealDenyDate;
    const firstDeleteDate = afterFirst?.flaggedDeleteDate;

    const scheduledAfterFirst = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailsAfterFirst = scheduledAfterFirst.filter((s) =>
      s.name.includes("sendFlagDecisionEmail"),
    ).length;

    // Tweede deny — moet no-op zijn.
    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.photos.decideFlag,
      { photoId, approve: false },
    );

    const afterSecond = await t.run((ctx) => ctx.db.get(photoId));
    // countdown niet gereset
    expect(afterSecond?.flaggedDeleteDate).toBe(firstDeleteDate);
    // denyDate ongewijzigd (niet overschreven met nieuwe Date.now())
    expect(afterSecond?.flaggedAppealDenyDate).toBe(firstDenyDate);
    // photo blijft in denied state (alle relevante velden gezet)
    expect(typeof afterSecond?.flaggedAt).toBe("number");
    expect(typeof afterSecond?.flaggedAppealDate).toBe("number");

    // Geen tweede email gequeued
    const scheduledAfterSecond = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailsAfterSecond = scheduledAfterSecond.filter((s) =>
      s.name.includes("sendFlagDecisionEmail"),
    ).length;
    expect(emailsAfterSecond).toBe(emailsAfterFirst);
  });
});

describe("photos.decideFlag — guards", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // flagPhotoDecide.js regel 76-77
  it("decideFlag gooit als foto niet geflagged is", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
        api.photos.decideFlag,
        { photoId, approve: true },
      ),
    ).rejects.toThrow();
  });

  it("decideFlag gooit als foto wel geflagged maar niet appealed is", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });

    await expect(
      withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
        api.photos.decideFlag,
        { photoId, approve: true },
      ),
    ).rejects.toThrow();
  });
});
