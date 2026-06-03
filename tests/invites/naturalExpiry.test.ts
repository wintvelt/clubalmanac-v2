// WP9 / IB2 — natural-expiry cron, RED-phase spec.
//
// Cascade-matrix IB2 (system events): een daily cron patcht invites met
// `status="pending"` en `expiresAt <= now` naar `status="expired"`. Natural
// expiry, los van het bounce-pad (IB1 `handleBounce`). Dit is GEEN cascade en
// GEEN delete — een self-contained single-row status-transitie (cascade-matrix
// cat: n.v.t.). Géén andere tabel, géén storage, géén email.
//
// Functie-shape (B implementeert):
//   internal.invites.expirePendingInvites({}): void | { expired: number }
//     - Fetch pending invites via `by_status`-index (q.eq("status","pending"))
//     - In-memory filter `expiresAt <= now` (by_status is single-field, géén
//       composite met expiresAt → geen range-query mogelijk; zelfde patroon als
//       IB1 handleBounce die by_email collect't + in-memory status-filtert)
//     - Per match: ctx.db.patch(id, { status: "expired" }) — schrijft NOOIT
//       bouncedAt of respondedAt, queue't GEEN email
//   De tests hangen NIET aan de return-shape (void of count beide groen).
//
// Cron-registratie (zie tests/crons/registration.test.ts):
//   crons.daily("expire pending invites", { hourUTC: 4, minuteUTC: 0 },
//     internal.invites.expirePendingInvites, {})
//
// Boundary-semantiek: `<=` (boundary-moment telt als verlopen). Consistent met
// FL1 `flaggedDeleteDate <= now`, invites `accept` `expiresAt <= Date.now()`,
// en gespiegeld met `create`/`hasPendingForEmail` (`expiresAt > now` = geldig).
// Audit-9 (FL1) + audit-12 (UI1) precedent: boundary echt pinnen via
// vi.useFakeTimers() + vi.setSystemTime(), niet via Date.now()-slop.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

// Pinned clock: alle Date.now()-calls (test-seed + impl) zien dezelfde tijd,
// dus boundary-assertie op expiresAt === FIXED_NOW is exact (<=, niet <).
const FIXED_NOW = new Date("2026-06-01T04:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

type SeedInvite = {
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: number;
  bouncedAt?: number;
  respondedAt?: number;
  token?: string;
};

// Seed één inviter-user + een invite-rij met exact te controleren velden.
// Direct via ctx.db (niet via api.invites.create) zodat we expiresAt/status/
// bouncedAt/respondedAt precies kunnen pinnen zonder de mail-side-effects en
// dedup-guards van de create-mutation.
async function seedInvite(
  t: ReturnType<typeof convexTest>,
  invite: SeedInvite,
): Promise<Id<"invites">> {
  return await t.run(async (ctx) => {
    const inviterId = await ctx.db.insert("users", {
      subject: `subj_${invite.token ?? invite.status}_${invite.expiresAt}`,
      email: `inviter_${invite.expiresAt}@x.com`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: FIXED_NOW - 30 * DAY_MS,
    });
    return await ctx.db.insert("invites", {
      email: "invitee@x.com",
      invitedBy: inviterId,
      token: invite.token ?? `tk_${invite.status}_${invite.expiresAt}`,
      status: invite.status,
      expiresAt: invite.expiresAt,
      createdAt: FIXED_NOW - 30 * DAY_MS,
      ...(invite.bouncedAt !== undefined ? { bouncedAt: invite.bouncedAt } : {}),
      ...(invite.respondedAt !== undefined
        ? { respondedAt: invite.respondedAt }
        : {}),
    });
  });
}

async function scheduledCount(
  t: ReturnType<typeof convexTest>,
): Promise<number> {
  return await t.run(
    async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).length,
  );
}

describe("internal.invites.expirePendingInvites — boundary (<=, fake clock)", () => {
  it("pending met expiresAt === now + 1ms blijft pending", async () => {
    const t = convexTest(schema);
    const id = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW + 1,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("pending");
  });

  it("pending met expiresAt === now wordt expired (boundary inclusief)", async () => {
    const t = convexTest(schema);
    const id = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("expired");
  });

  it("pending met expiresAt === now - 1ms wordt expired", async () => {
    const t = convexTest(schema);
    const id = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - 1,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("expired");
  });
});

describe("internal.invites.expirePendingInvites — status-filter exclusiviteit", () => {
  it("raakt accepted / declined / reeds-expired niet, ook bij expiresAt < now", async () => {
    const t = convexTest(schema);
    const acceptedId = await seedInvite(t, {
      status: "accepted",
      expiresAt: FIXED_NOW - DAY_MS,
      respondedAt: FIXED_NOW - 2 * DAY_MS,
      token: "tk_accepted",
    });
    const declinedId = await seedInvite(t, {
      status: "declined",
      expiresAt: FIXED_NOW - DAY_MS,
      respondedAt: FIXED_NOW - 2 * DAY_MS,
      token: "tk_declined",
    });
    const expiredId = await seedInvite(t, {
      status: "expired",
      expiresAt: FIXED_NOW - DAY_MS,
      token: "tk_already_expired",
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    expect((await t.run((ctx) => ctx.db.get(acceptedId)))?.status).toBe(
      "accepted",
    );
    expect((await t.run((ctx) => ctx.db.get(declinedId)))?.status).toBe(
      "declined",
    );
    expect((await t.run((ctx) => ctx.db.get(expiredId)))?.status).toBe(
      "expired",
    );
  });

  it("bounce-expired rij (status=expired, bouncedAt gezet) blijft onaangeraakt — bouncedAt hands-off", async () => {
    // Invariant 3: IB2 mag bouncedAt nooit clearen/overschrijven. Een rij die
    // al via IB1 als bounce-expired gemarkeerd is, is terminal.
    const t = convexTest(schema);
    const bouncedExpiredId = await seedInvite(t, {
      status: "expired",
      expiresAt: FIXED_NOW - DAY_MS,
      bouncedAt: FIXED_NOW - 3 * DAY_MS,
      token: "tk_bounce_expired",
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    const row = await t.run((ctx) => ctx.db.get(bouncedExpiredId));
    expect(row?.status).toBe("expired");
    expect(row?.bouncedAt).toBe(FIXED_NOW - 3 * DAY_MS);
  });
});

describe("internal.invites.expirePendingInvites — fingerprint (bouncedAt + respondedAt ongezet)", () => {
  it("natural-expired rij heeft géén bouncedAt en géén respondedAt na patch (inv. 3 + 8)", async () => {
    const t = convexTest(schema);
    const id = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - DAY_MS,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status).toBe("expired");
    expect(row?.bouncedAt).toBeUndefined();
    expect(row?.respondedAt).toBeUndefined();
  });
});

describe("internal.invites.expirePendingInvites — stille expiry (geen email)", () => {
  it("queue't geen email-action, ook bij meerdere verlopen pending invites", async () => {
    // Invariant 4: inviter krijgt GEEN notify bij natural expiry (alleen IB1
    // bounce-pad verstuurt). Eerste-run op stale dataset → geen email-storm.
    const t = convexTest(schema);
    await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - DAY_MS,
      token: "tk_a",
    });
    await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - 2 * DAY_MS,
      token: "tk_b",
    });

    const before = await scheduledCount(t);
    await t.mutation(internal.invites.expirePendingInvites, {});
    const after = await scheduledCount(t);

    expect(after).toBe(before);
  });
});

describe("internal.invites.expirePendingInvites — idempotency over runs", () => {
  it("tweede run laat een al-geëxpirede rij ongewijzigd (stabiel, geen email)", async () => {
    // "Nul writes" is niet direct meetbaar in convex-test; het observeerbare
    // equivalent: tweede run verandert de rij niet (status blijft expired,
    // geen nieuwe bouncedAt/respondedAt) én voegt geen scheduled functions toe.
    // Garanderend mechanisme = de status-filter (al-expired matcht niet meer),
    // óók gepind door de exclusiviteits-test hierboven.
    const t = convexTest(schema);
    const id = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - DAY_MS,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});
    const afterFirst = await t.run((ctx) => ctx.db.get(id));
    const scheduledAfterFirst = await scheduledCount(t);

    await t.mutation(internal.invites.expirePendingInvites, {});
    const afterSecond = await t.run((ctx) => ctx.db.get(id));
    const scheduledAfterSecond = await scheduledCount(t);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond?.status).toBe("expired");
    expect(afterSecond?.bouncedAt).toBeUndefined();
    expect(afterSecond?.respondedAt).toBeUndefined();
    expect(scheduledAfterSecond).toBe(scheduledAfterFirst);
  });
});

describe("internal.invites.expirePendingInvites — cascade-vrijheid", () => {
  it("schrijft geen inviteBounceEvents en raakt memberships niet aan", async () => {
    // Invariant 7: single-row-patch op invites. Geen membership-touch, geen
    // inviteBounceEvents-write (dat is IB1's dedup-store, niet IB2's).
    const t = convexTest(schema);

    const membershipId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "subj_member",
        email: "member@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      const groupId = await ctx.db.insert("groups", {
        name: "G",
        createdBy: userId,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      return await ctx.db.insert("memberships", {
        userId,
        groupId,
        role: "member",
        joinedAt: FIXED_NOW - 30 * DAY_MS,
      });
    });
    await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - DAY_MS,
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    const bounceEvents = await t.run((ctx) =>
      ctx.db.query("inviteBounceEvents").collect(),
    );
    expect(bounceEvents).toHaveLength(0);

    const membership = await t.run((ctx) => ctx.db.get(membershipId));
    expect(membership?.role).toBe("member");
  });
});

describe("internal.invites.expirePendingInvites — mixed dataset + no-op", () => {
  it("één run patcht uitsluitend de verlopen pending rijen, laat de rest staan", async () => {
    const t = convexTest(schema);
    const expiredPending = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW - DAY_MS,
      token: "tk_exp_pending",
    });
    const freshPending = await seedInvite(t, {
      status: "pending",
      expiresAt: FIXED_NOW + DAY_MS,
      token: "tk_fresh_pending",
    });
    const accepted = await seedInvite(t, {
      status: "accepted",
      expiresAt: FIXED_NOW - DAY_MS,
      respondedAt: FIXED_NOW - 2 * DAY_MS,
      token: "tk_acc",
    });

    await t.mutation(internal.invites.expirePendingInvites, {});

    expect((await t.run((ctx) => ctx.db.get(expiredPending)))?.status).toBe(
      "expired",
    );
    expect((await t.run((ctx) => ctx.db.get(freshPending)))?.status).toBe(
      "pending",
    );
    expect((await t.run((ctx) => ctx.db.get(accepted)))?.status).toBe(
      "accepted",
    );
  });

  it("lege dataset: no-op (geen throw)", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.invites.expirePendingInvites, {}),
    ).resolves.not.toThrow();
  });
});
