import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// FL2 — photos.flag mutation. Bron: oude AWS handler
// blob-images-api-photos/handlersPhoto/flagPhoto.js (regel 10-29):
//   - non-owner only ("cannot flag your own photos")
//   - idempotent: als al flaggedDate gezet, return zonder update
//   - sets flaggedDate, flaggedDeleteDate (=now+14d), flaggedBy
//
// In v2 schema: flaggedAt (was flaggedDate), flaggedBy, flagReason (nieuw),
// flaggedDeleteDate (nieuw, B implementeert via schema-uitbreiding).
//
// 14d countdown const: zie flagPhoto.js regel 8 (DELETE_DAYS = 14).

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const DELETE_DAYS = 14;
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
  const userId = await withUser(t, subject).mutation(api.users.register, { email });
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

describe("photos.flag — non-owner only", () => {
  // flagPhoto.js regel 16: throw 'cannot flag your own photos'
  it("eigen foto flaggen gooit error", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_alice").mutation(api.photos.flag, { photoId }),
    ).rejects.toThrow();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.flaggedAt).toBeUndefined();
    expect(photo?.flaggedBy).toBeUndefined();
  });

  it("foto van andere user flaggen lukt en zet alle flag-velden", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    const before = Date.now();
    await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });
    const after = Date.now();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(typeof photo?.flaggedAt).toBe("number");
    expect(photo?.flaggedAt).toBeGreaterThanOrEqual(before);
    expect(photo?.flaggedAt).toBeLessThanOrEqual(after);
    expect(photo?.flaggedBy).not.toBe(aliceId); // niet zichzelf
    expect(typeof photo?.flaggedDeleteDate).toBe("number");
    // flaggedDeleteDate ligt rond 14 dagen na flaggedAt
    const expected = (photo!.flaggedAt as number) + DELETE_DAYS * DAY_MS;
    expect(
      Math.abs((photo!.flaggedDeleteDate as number) - expected),
    ).toBeLessThan(60_000);
  });

  it("flagReason wordt opgeslagen wanneer meegegeven", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await withUser(t, "user_bob").mutation(api.photos.flag, {
      photoId,
      reason: "ongepast",
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.flagReason).toBe("ongepast");
  });

  it("flagReason is optioneel", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_bob").mutation(api.photos.flag, { photoId }),
    ).resolves.not.toThrow();
  });
});

describe("photos.flag — idempotent", () => {
  // flagPhoto.js regel 19: if (photo.flaggedDate) return cleanRecord(photo)
  it("tweede flag-call vervangt eerste flagger of timestamps niet", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });
    const after1 = await t.run((ctx) => ctx.db.get(photoId));
    const firstFlaggedAt = after1?.flaggedAt;
    const firstDeleteDate = after1?.flaggedDeleteDate;

    // korte pauze niet nodig — assertion is op equality, niet op delta
    await withUser(t, "user_carol").mutation(api.photos.flag, { photoId });
    const after2 = await t.run((ctx) => ctx.db.get(photoId));

    expect(after2?.flaggedAt).toBe(firstFlaggedAt);
    expect(after2?.flaggedBy).toBe(bobId);
    expect(after2?.flaggedDeleteDate).toBe(firstDeleteDate);
  });

  // Audit-9 §8.5: na webmaster-approve zijn alle flag-velden cleared en
  // moet de photo opnieuw flagbaar zijn (state machine begint van voren
  // af aan). Bestaand gedrag pinnen — geen code-fix verwacht.
  it("flag na webmaster approve werkt — alle velden cleared, opnieuw flagbaar", async () => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
    try {
      const t = convexTest(schema);
      await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");
      const carolId = await registerUser(t, "user_carol", "c@x.com");
      await registerUser(t, "user_wm", WEBMASTER_EMAIL);

      const storageId = await uploadStorage(t);
      const photoId = await withUser(t, "user_alice").mutation(
        api.photos.create,
        { storageId },
      );

      // Volle flag → appeal → approve flow.
      await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });
      await withUser(t, "user_alice").mutation(api.photos.appeal, { photoId });
      await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
        api.photos.decideFlag,
        { photoId, approve: true },
      );

      const cleared = await t.run((ctx) => ctx.db.get(photoId));
      expect(cleared?.flaggedAt).toBeUndefined();
      expect(cleared?.flaggedBy).toBeUndefined();
      expect(cleared?.flaggedDeleteDate).toBeUndefined();

      // Carol flagt opnieuw — state machine start vers.
      const before = Date.now();
      await withUser(t, "user_carol").mutation(api.photos.flag, {
        photoId,
        reason: "tweede ronde",
      });
      const after = Date.now();

      const reflagged = await t.run((ctx) => ctx.db.get(photoId));
      expect(typeof reflagged?.flaggedAt).toBe("number");
      expect(reflagged?.flaggedAt).toBeGreaterThanOrEqual(before);
      expect(reflagged?.flaggedAt).toBeLessThanOrEqual(after);
      expect(reflagged?.flaggedBy).toBe(carolId);
      expect(reflagged?.flagReason).toBe("tweede ronde");
      const expected = (reflagged!.flaggedAt as number) + DELETE_DAYS * DAY_MS;
      expect(
        Math.abs((reflagged!.flaggedDeleteDate as number) - expected),
      ).toBeLessThan(60_000);
      // bobId niet meer relevant — eerste flagger is overschreven door carol
      void bobId;
    } finally {
      delete process.env.WEBMASTER_EMAILS;
    }
  });

  it("photo niet gevonden gooit error", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_bob", "b@x.com");

    // [GAP] oude code throwde 'photo not found'; we testen alleen dat het throwt.
    // Een fake photoId genereren is in convex-test lastig zonder echte id —
    // we maken er één en deleten 'm.
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    void aliceId;
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });

    await expect(
      withUser(t, "user_bob").mutation(api.photos.flag, { photoId }),
    ).rejects.toThrow();
  });
});
