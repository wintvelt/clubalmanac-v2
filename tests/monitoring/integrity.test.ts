// WP10 — integrity-check / monitoring, RED-phase spec.
//
// Een daily cron `internal.monitoring.integrityCheck` (internalMutation, 04:30
// UTC) scant de DB op stille datakorruptie in vier categorieën — storage-
// orphans, aggregate-drift, FK-integriteit, en geen-self-healing — en queue't
// bij drift één samenvattende alert-email naar WEBMASTER_EMAILS. Detect-only:
// de monitor fixt NOOIT iets. Zie docs/work-packages/WP10-integrity-monitoring.md.
//
// Architectuur (A's vorm-keuze, B implementeert):
//   internal.monitoring.integrityCheck({}): internalMutation
//     - één Convex-mutation = één transactie/snapshot ⇒ race-resistentie (inv 11)
//     - schrijft uitsluitend `monitoringRuns` (inv 10), console.log áltijd (inv 5)
//     - queue't `internal.monitoring.sendMonitoringAlert` action bij drift /
//       heartbeat via ctx.scheduler.runAfter (sendProblemReport-patroon)
//   De alert-action stuurt via sendMailjetMessage, from=INFO_SENDER, naar
//   getWebmasterEmails(). Deze tests hangen NIET aan de action-arg-shape: email-
//   gedrag wordt end-to-end gepind door scheduled functions te drainen met een
//   gemockte fetch (mirror van tests/features/sendProblemReport.test.ts).
//
// Observatie-strategie (geen impl-shape-koppeling):
//   - "email gequeue'd ja/nee" → delta in _scheduled_functions vóór/na de run
//     (sendProblemReport + naturalExpiry precedent)
//   - "email-body / sender / PII" → finishAllScheduledFunctions + fetch-spy
//   - "read-only / geen self-heal" → bron-waarde blijft ná de run ongewijzigd
//
// monitoringRuns staat (nog) niet in schema — dat is B's additive schema-edit.
// Deze tests queryen die tabel daarom NIET; ze observeren user-truth (email-
// gedrag + ongewijzigde bron-data), niet impl-state.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-06-01T04:30:00.000Z").getTime();

const INFO_SENDER = "info@clubalmanac.com";
const WEBMASTER_EMAIL = "webmaster@x.com";

// Forward-declared ref voor B's nog-niet-bestaande internalMutation. Runtime
// resolveert pre-impl naar undefined ⇒ t.mutation(undefined, …) throwt ⇒ RED.
const integrityCheckRef = (
  internal as unknown as {
    monitoring: {
      integrityCheck: FunctionReference<
        "mutation",
        "internal",
        Record<string, never>
      >;
    };
  }
).monitoring.integrityCheck;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  process.env.MAILJET_VERIFIED_SENDERS = INFO_SENDER;
  process.env.MAILJET_API_KEY = "k";
  process.env.MAILJET_API_SECRET = "s";
  process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.MAILJET_VERIFIED_SENDERS;
  delete process.env.MAILJET_API_KEY;
  delete process.env.MAILJET_API_SECRET;
  delete process.env.WEBMASTER_EMAILS;
  vi.unstubAllGlobals();
});

// ───────────────────────── helpers ─────────────────────────

type T = ReturnType<typeof convexTest>;

async function storeBlob(t: T): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

async function scheduledCount(t: T): Promise<number> {
  return await t.run(
    async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).length,
  );
}

// Draai de monitor één keer en geef terug hoeveel scheduled functions er
// bijkwamen (1 = alert/heartbeat gequeue'd, 0 = geen email).
async function runMonitorDelta(t: T): Promise<number> {
  const before = await scheduledCount(t);
  await t.mutation(integrityCheckRef, {});
  const after = await scheduledCount(t);
  return after - before;
}

type MailjetMessage = {
  From?: { Email?: string };
  To?: Array<{ Email?: string }>;
  Subject?: string;
  HTMLPart?: string;
  TextPart?: string;
};

function mockMailjet2xx(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function allMailjetMessages(
  fetchSpy: ReturnType<typeof vi.fn>,
): MailjetMessage[] {
  const out: MailjetMessage[] = [];
  for (const call of fetchSpy.mock.calls) {
    const init = call[1] as RequestInit;
    const payload = JSON.parse(
      typeof init.body === "string" ? init.body : "",
    ) as { Messages?: MailjetMessage[] };
    for (const m of payload.Messages ?? []) out.push(m);
  }
  return out;
}

// Minimale schone user (photoCount klopt met aantal photos).
async function seedUser(
  t: T,
  opts: { photoCount: number; name?: string; email?: string } = {
    photoCount: 0,
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject: `subj_${opts.name ?? "u"}_${opts.email ?? Math.floor(FIXED_NOW)}`,
      email: opts.email ?? "u@x.com",
      name: opts.name,
      photoCount: opts.photoCount,
      photoLimit: 1000,
      createdAt: FIXED_NOW - 30 * DAY_MS,
    }),
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. Storage-orphans (invariant 2a)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — storage-orphans (inv 2a)", () => {
  it("0 orphans (elke blob referenced door een photo) → OK-run, geen email", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW,
      }),
    );

    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("1 ongerefereerde blob → drift, email gequeue'd", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 0 });
    await storeBlob(t); // orphan: geen photo verwijst ernaar

    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("blob die alléén via users.profilePhotoStorageId gerefereerd wordt is GEEN orphan", async () => {
    // [A-correctie op inv 2a] profielfoto's zijn een legitieme storage-
    // referentie naast photos.storageId. Een monitor die alléén photos.storageId
    // checkt zou élke profielfoto als vals-positief orphan flaggen. Deze test
    // faalt bij die onvolledige impl en is daarmee het anker voor de fix.
    const t = convexTest(schema);
    const profileBlob = await storeBlob(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        subject: "subj_profile",
        email: "p@x.com",
        profilePhotoStorageId: profileBlob,
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
    });

    expect(await runMonitorDelta(t)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Aggregate-drift (invariant 2b + 3)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — aggregate-drift: users.photoCount", () => {
  it("photoCount klopt met aantal eigen photos → OK", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 2 });
    for (let i = 0; i < 2; i++) {
      const storageId = await storeBlob(t);
      await t.run((ctx) =>
        ctx.db.insert("photos", {
          ownerId,
          storageId,
          ratingCount: 0,
          createdAt: FIXED_NOW,
        }),
      );
    }
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("photoCount=5 maar 0 photos → drift", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 5 });
    expect(await runMonitorDelta(t)).toBe(1);
  });
});

describe("integrityCheck — aggregate-drift: photos.ratingAverage/ratingCount", () => {
  it("ratingAverage=4.5 + ratingCount=2 matcht ratings [4,5] → OK (oracle: handberekend 4.5)", async () => {
    // Oracle-anker (ab-audit-workflow §anti-pattern): 4.5 is handberekend, niet
    // recompute-vs-recompute. Pint de aggregate-formule tegen een onafhankelijk
    // getal zodat een wrong-but-self-consistent recompute niet stilletjes slaagt.
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    const photoId = await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 2,
        ratingAverage: 4.5,
        createdAt: FIXED_NOW,
      }),
    );
    for (const value of [4, 5]) {
      await t.run((ctx) =>
        ctx.db.insert("ratings", {
          photoId,
          userId: ownerId,
          value,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        }),
      );
    }
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("ratingCount=3 maar slechts 2 ratings → drift", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    const photoId = await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 3,
        ratingAverage: 4.5,
        createdAt: FIXED_NOW,
      }),
    );
    for (const value of [4, 5]) {
      await t.run((ctx) =>
        ctx.db.insert("ratings", {
          photoId,
          userId: ownerId,
          value,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        }),
      );
    }
    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("ratingAverage-drift van 0.5 (stored 4.0, werkelijk 4.5) → drift (epsilon, NIET >=1-drempel)", async () => {
    // [A-verfijning inv 3] ratingAverage is float; een naïeve >=1-drempel zou
    // deze Δ0.5-drift missen. Werkelijke avg van [4,5] = 4.5 (handberekend);
    // stored 4.0 ⇒ |Δ| = 0.5 > 1e-9 ⇒ drift. ratingCount=2 klopt hier wél, dus
    // dit isoleert de ratingAverage-tak.
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    const photoId = await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 2,
        ratingAverage: 4.0,
        createdAt: FIXED_NOW,
      }),
    );
    for (const value of [4, 5]) {
      await t.run((ctx) =>
        ctx.db.insert("ratings", {
          photoId,
          userId: ownerId,
          value,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        }),
      );
    }
    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("ratingAverage undefined + ratingCount=0 + geen ratings → OK", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW,
      }),
    );
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("ratingAverage gezet (3.0) terwijl 0 ratings (count 0) → drift (undefined-grens)", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 0,
        ratingAverage: 3.0,
        createdAt: FIXED_NOW,
      }),
    );
    expect(await runMonitorDelta(t)).toBe(1);
  });
});

describe("integrityCheck — aggregate-drift: features.upvoteCount", () => {
  it("upvoteCount klopt met aantal featureUpvotes → OK", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 0 });
    const featureId = await t.run((ctx) =>
      ctx.db.insert("features", {
        type: "feature",
        title: "t",
        description: "d",
        submittedBy: userId,
        status: "open",
        upvoteCount: 1,
        createdAt: FIXED_NOW,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("featureUpvotes", {
        featureId,
        userId,
        createdAt: FIXED_NOW,
      }),
    );
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("upvoteCount=4 maar 0 upvotes → drift", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 0 });
    await t.run((ctx) =>
      ctx.db.insert("features", {
        type: "feature",
        title: "t",
        description: "d",
        submittedBy: userId,
        status: "open",
        upvoteCount: 4,
        createdAt: FIXED_NOW,
      }),
    );
    expect(await runMonitorDelta(t)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. FK-integriteit (invariant 2c)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — FK-integriteit (inv 2c)", () => {
  it("alle FKs resolven → OK", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 0 });
    const groupId = await t.run((ctx) =>
      ctx.db.insert("groups", {
        name: "G",
        createdBy: userId,
        createdAt: FIXED_NOW,
      }),
    );
    const albumId = await t.run((ctx) =>
      ctx.db.insert("albums", {
        groupId,
        name: "A",
        createdBy: userId,
        createdAt: FIXED_NOW,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("albumLastSeen", {
        userId,
        albumId,
        lastSeenAt: FIXED_NOW,
      }),
    );
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("verplichte FK dangling (albumLastSeen.albumId → verwijderd album) → drift", async () => {
    // Geen storage/aggregate-confound: albums/albumLastSeen zitten in geen enkel
    // aggregaat. Na delete dangelt uitsluitend albumLastSeen.albumId.
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 0 });
    const albumId = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("groups", {
        name: "G",
        createdBy: userId,
        createdAt: FIXED_NOW,
      });
      return ctx.db.insert("albums", {
        groupId,
        name: "A",
        createdBy: userId,
        createdAt: FIXED_NOW,
      });
    });
    await t.run((ctx) =>
      ctx.db.insert("albumLastSeen", {
        userId,
        albumId,
        lastSeenAt: FIXED_NOW,
      }),
    );
    await t.run((ctx) => ctx.db.delete(albumId));

    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("optionele FK ongezet (photos.flaggedBy undefined) → GEEN drift", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 1 });
    const storageId = await storeBlob(t);
    await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW,
        // flaggedBy bewust ongezet — een ongezette optionele FK is geen dangling FK
      }),
    );
    expect(await runMonitorDelta(t)).toBe(0);
  });

  it("optionele FK gezet maar dangling (groups.coverPhotoId → verwijderde photo) → drift", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 0 });
    const storageId = await storeBlob(t);
    const photoId = await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId: userId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("groups", {
        name: "G",
        coverPhotoId: photoId,
        createdBy: userId,
        createdAt: FIXED_NOW,
      }),
    );
    // Verwijder photo + zijn blob ⇒ alleen coverPhotoId dangelt (geen orphan-blob,
    // geen photoCount-drift want owner photoCount=0).
    await t.run(async (ctx) => {
      await ctx.db.delete(photoId);
      await ctx.storage.delete(storageId);
    });

    expect(await runMonitorDelta(t)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Tolerantie strict + lege DB
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — tolerantie + lege DB", () => {
  it("exact 1 verschil (photoCount=1, 0 photos) → drift", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 1 });
    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("lege DB → OK-run, geen email, geen throw", async () => {
    const t = convexTest(schema);
    expect(await runMonitorDelta(t)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. State-tabel dedup (invariant 4)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — dedup via drift-signature (inv 4)", () => {
  it("identieke persistente drift → één email; gewijzigde drift → nieuwe email", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 0 });

    // Run A: 1 orphan-blob ⇒ drift-signature X ⇒ email.
    await storeBlob(t);
    expect(await runMonitorDelta(t)).toBe(1);

    // Run B (zelfde dag, <30d): zelfde orphan, zelfde signature ⇒ géén 2e email.
    vi.setSystemTime(FIXED_NOW + DAY_MS);
    expect(await runMonitorDelta(t)).toBe(0);

    // Run C: 2e orphan toegevoegd ⇒ signature wijzigt ⇒ wél nieuwe email.
    await storeBlob(t);
    vi.setSystemTime(FIXED_NOW + 2 * DAY_MS);
    expect(await runMonitorDelta(t)).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Heartbeat (invariant 6) — A's keuze: inline state-check
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — maandelijkse heartbeat (inv 6)", () => {
  it("OK-run <30d na baseline → geen email; OK-run >=30d → heartbeat", async () => {
    // Lege DB blijft alle runs OK. Contrast d1 (=0) vs d2 (=1) pint de 30d-regel
    // ongeacht of de allereerste run zelf al mailt: een impl die lastHeartbeatAt
    // nooit bijwerkt zou bij d1 al mailen en faalt hier.
    const t = convexTest(schema);

    // T0: baseline-run.
    await runMonitorDelta(t);

    // T0 + 10d: nog binnen 30d ⇒ geen heartbeat.
    vi.setSystemTime(FIXED_NOW + 10 * DAY_MS);
    const d1 = await runMonitorDelta(t);

    // T0 + 31d: >=30d sinds laatste email ⇒ heartbeat.
    vi.setSystemTime(FIXED_NOW + 31 * DAY_MS);
    const d2 = await runMonitorDelta(t);

    expect(d1).toBe(0);
    expect(d2).toBe(1);
  });

  it("drift-email reset de heartbeat-klok (geen heartbeat 10d na een drift-mail)", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 3 }); // persistente photoCount-drift

    // T0: drift ⇒ email (reset heartbeat-klok).
    expect(await runMonitorDelta(t)).toBe(1);

    // T0 + 10d: drift nog aanwezig maar zelfde signature ⇒ dedup ⇒ geen drift-
    // email; en <30d sinds laatste mail ⇒ ook geen heartbeat.
    vi.setSystemTime(FIXED_NOW + 10 * DAY_MS);
    expect(await runMonitorDelta(t)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Eén samenvattende email per run (invariant 8)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — één samenvattende email per run (inv 8)", () => {
  it("5 drift-rijen in één scan → exact 1 alert-action gequeue'd, 1 Mailjet-send", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 0 });
    for (let i = 0; i < 5; i++) await storeBlob(t); // 5 orphan-blobs

    const fetchSpy = mockMailjet2xx();
    const delta = await runMonitorDelta(t);
    expect(delta).toBe(1); // niet 5

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(allMailjetMessages(fetchSpy)).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 8. Email-bestemming + PII-grens (invarianten 7 + 9)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — email-bestemming + PII-grens (inv 7 + 9)", () => {
  it("drift-email gaat van INFO_SENDER naar WEBMASTER_EMAILS", async () => {
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 2 }); // drift

    const fetchSpy = mockMailjet2xx();
    await t.mutation(integrityCheckRef, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const msgs = allMailjetMessages(fetchSpy);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0]!.From?.Email?.toLowerCase()).toBe(INFO_SENDER);
    const recipients = msgs.flatMap((m) =>
      (m.To ?? []).map((r) => r.Email?.toLowerCase()),
    );
    expect(recipients).toContain(WEBMASTER_EMAIL.toLowerCase());
  });

  it("alert-body bevat IDs/counts/table-namen maar GEEN user-content (name/email)", async () => {
    // Inv 9: alleen IDs + counts + table-namen. Seed een user met herkenbare PII
    // die in een drift-rij betrokken is (photoCount-drift). De mail mag de naam/
    // email NIET bevatten, maar wél de record-id (IDs zijn toegestaan).
    const t = convexTest(schema);
    const userId = await seedUser(t, {
      photoCount: 3,
      name: "PIISECRETNAME",
      email: "piisecret@x.com",
    });

    const fetchSpy = mockMailjet2xx();
    await t.mutation(integrityCheckRef, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const msgs = allMailjetMessages(fetchSpy);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const body = (msgs[0]!.HTMLPart ?? "") + (msgs[0]!.TextPart ?? "");

    // PII-lek: verboden.
    expect(body).not.toContain("PIISECRETNAME");
    expect(body).not.toContain("piisecret@x.com");
    // IDs + counts + table-naam: toegestaan/verwacht.
    expect(body).toContain(userId);
    expect(body.toLowerCase()).toContain("users");
  });
});

// ════════════════════════════════════════════════════════════════════
// 9. Read-only-discipline + geen self-healing (invarianten 10 + 2d)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — read-only + geen self-healing (inv 10 + 2d)", () => {
  it("gedrifte photoCount blijft ná de run ongewijzigd (monitor fixt niet)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 7 }); // 0 photos → drift

    await t.mutation(integrityCheckRef, {});

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.photoCount).toBe(7); // NIET naar 0 "gerepareerd"
  });

  it("muteert geen rijen in bron-tabellen (photos/users/ratings counts onveranderd)", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t, { photoCount: 9 }); // drift
    const storageId = await storeBlob(t);
    const photoId = await t.run((ctx) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        ratingCount: 5, // ratingCount-drift
        ratingAverage: 2.0,
        createdAt: FIXED_NOW,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("ratings", {
        photoId,
        userId: ownerId,
        value: 2,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }),
    );

    const countAll = async () =>
      await t.run(async (ctx) => ({
        users: (await ctx.db.query("users").collect()).length,
        photos: (await ctx.db.query("photos").collect()).length,
        ratings: (await ctx.db.query("ratings").collect()).length,
      }));

    const before = await countAll();
    await t.mutation(integrityCheckRef, {});
    const after = await countAll();

    expect(after).toEqual(before);
  });
});

// ════════════════════════════════════════════════════════════════════
// 10. Audit-fix S-1 (strict-consecutive dedup) + N-1 (heartbeat-tekst)
// ════════════════════════════════════════════════════════════════════

describe("integrityCheck — recurrence-na-clean re-alert (audit S-1, inv 4)", () => {
  it("drift X → schone run → drift X = RE-alert (vergelijk met direct voorgaande run, niet laatst-gealerte)", async () => {
    // Strict-consecutive: de schone tussenrun reset de dedup-referentie naar "".
    // De terugkerende identieke drift is conceptueel een nieuw event en moet
    // opnieuw alarmeren. Tegen de OUDE "laatst-gealerte-run"-regel zou run 3
    // gededupt worden (X === X) en delta 0 geven — vandaar RED tot B de fix landt.
    const t = convexTest(schema);
    const userId = await seedUser(t, { photoCount: 5 }); // drift X: photoCount 5 vs 0 photos

    // Run 1: drift X → alert.
    expect(await runMonitorDelta(t)).toBe(1);

    // Run 2: drift opgelost (photoCount → 0) → schone run, geen email.
    await t.run((ctx) => ctx.db.patch(userId, { photoCount: 0 }));
    vi.setSystemTime(FIXED_NOW + DAY_MS);
    expect(await runMonitorDelta(t)).toBe(0);

    // Run 3: identieke drift X keert terug (photoCount → 5) → RE-alert.
    await t.run((ctx) => ctx.db.patch(userId, { photoCount: 5 }));
    vi.setSystemTime(FIXED_NOW + 2 * DAY_MS);
    expect(await runMonitorDelta(t)).toBe(1);
  });

  it("persistente identieke drift over opeenvolgende runs blijft één email (strict-consecutive dedupt nog steeds)", async () => {
    // Regressie-guard: de S-1-fix mag de normale storm-onderdrukking niet breken.
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 5 });

    expect(await runMonitorDelta(t)).toBe(1); // run 1: alert
    vi.setSystemTime(FIXED_NOW + DAY_MS);
    expect(await runMonitorDelta(t)).toBe(0); // run 2: zelfde signature als run 1 → dedup
    vi.setSystemTime(FIXED_NOW + 2 * DAY_MS);
    expect(await runMonitorDelta(t)).toBe(0); // run 3: idem → dedup
  });
});

describe("integrityCheck — heartbeat-tekst conditioneel op gededupte drift (audit N-1, inv 6)", () => {
  it("heartbeat op een gededupte-drift-run waarschuwt voor openstaande drift + dashboard", async () => {
    // Persistente identieke drift: run 1 alarmeert, run 2 (30+ dagen later) wordt
    // door dedup géén drift-mail maar vuurt de heartbeat. Die heartbeat mag NIET
    // "geen nieuwe drift" suggereren — er ís openstaande drift. RED tot B de
    // template conditioneel maakt (driftPresent-tak met marker-zinsnede).
    const t = convexTest(schema);
    await seedUser(t, { photoCount: 4 }); // persistente drift

    const fetchSpy = mockMailjet2xx();

    // Run 1 (T0): drift → alert.
    await t.mutation(integrityCheckRef, {});

    // Run 2 (T0+31d): zelfde drift → gededupt (geen drift-mail) + heartbeat vuurt.
    vi.setSystemTime(FIXED_NOW + 31 * DAY_MS);
    await t.mutation(integrityCheckRef, {});

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const msgs = allMailjetMessages(fetchSpy);
    expect(msgs).toHaveLength(2); // drift-alert (run 1) + heartbeat (run 2)
    const heartbeat = msgs[msgs.length - 1]!; // laatst gescheduled = heartbeat
    const body = (
      (heartbeat.HTMLPart ?? "") + (heartbeat.TextPart ?? "")
    ).toLowerCase();

    expect(body).toContain("openstaande drift");
    expect(body).toContain("dashboard");
  });

  it("heartbeat op een schone run waarschuwt NIET voor openstaande drift", async () => {
    // Contrast-guard: bij een echt schone run mag de marker-zinsnede er niet zijn
    // (anders wordt elke heartbeat een vals alarm).
    const t = convexTest(schema); // lege DB → altijd schoon

    const fetchSpy = mockMailjet2xx();

    // Run 1 (T0): baseline (initialiseert heartbeat-klok, geen mail).
    await t.mutation(integrityCheckRef, {});

    // Run 2 (T0+31d): schoon + heartbeat vuurt.
    vi.setSystemTime(FIXED_NOW + 31 * DAY_MS);
    await t.mutation(integrityCheckRef, {});

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const msgs = allMailjetMessages(fetchSpy);
    expect(msgs).toHaveLength(1); // alleen de heartbeat
    const body = (
      (msgs[0]!.HTMLPart ?? "") + (msgs[0]!.TextPart ?? "")
    ).toLowerCase();

    expect(body).not.toContain("openstaande drift");
  });
});
