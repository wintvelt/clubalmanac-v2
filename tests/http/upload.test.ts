import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUserWithInvite, withUser } from "../_helpers/auth";

// File upload werkpakket — Cyclus 1, audit-cyclus-1 hardening (RED-phase spec).
//
// Achtergrond — oude flow had drie problemen die deze rewrite oplost:
//   1. Orphan storage objects bij client-crash tussen PUT en createFromUpload
//   2. Cross-user race bij gelijktijdige uploads (Pieterpad-scenario)
//   3. Niet retry-safe: dubbele POST = mogelijk dubbele photo records
//
// Audit-cyclus-1 vond drie productie-issues bovenop de eerste rewrite — alle
// drie cascaden uit één architectuur-keuze: idempotency was een post-fact log
// (record geschreven NA photo-creatie). Dat laat een race-window open tussen
// photo-insert en idempotency-insert: parallelle retries met dezelfde X-Upload-Id
// kunnen beiden aan photo-creatie toe komen. Fix: reservation pattern als state
// machine.
//
// Reservation pattern (audit-cyclus-1):
//   POST /upload arriveert →
//     Insert `uploadIdempotency` record met status="in_progress" ALS PRE-WORK,
//     unieke (ownerId, clientUploadId) afgedwongen via composite index.
//     Daarna pas storage.store + photo-create + scheduler.runAfter.
//     Tot slot: patch reservation naar status="completed" + photoId + completedAt.
//
//   Bij parallelle POST met zelfde (ownerId, clientUploadId): tweede transactie
//   ziet reservation in_progress (race-loser) → 409 Conflict; of completed →
//   return existing photoId. Geen window meer waarin beide kanten een photo
//   maken.
//
// Per-user scope via composite key (ownerId, clientUploadId): structureel
// kan user X de upload-id van user Y niet meer "kapen" — de lookup-key zelf
// scheidt users. Geen owner-mismatch fallthrough meer (was verdedigingslinie
// in cyclus 1, nu overbodig).
//
// Photo-limit error: typed sentinel string "PHOTO_LIMIT_REACHED" (vervangt
// `message.includes("limiet")` match). Status code: 403 Forbidden — semantisch
// correcter dan 413 (413 = Payload Too Large, slaat op body-size; 403 = quota
// /policy refuse). Response body blijft NL voor UX.
//
// Whitespace-trim op X-Upload-Id: "   " na trim → "" → 400 Missing.
//
// Body-size: Convex httpAction request-body limit ~20 MiB blijft. Voor cyclus 1
// niet-pinbaar (typische JPEG/HEIC < 10 MB), gedocumenteerd als known limitation
// in plan-doc — R2-pad in cyclus 3+.
//
// Nieuwe API:
//   POST /upload
//     Headers:
//       Authorization: Bearer <Clerk JWT>
//       X-Upload-Id: <client-generated UUID>     // idempotency key, getrimd server-side
//       Content-Type: image/jpeg | image/heic | ...
//       X-Filename: <optional>
//     Body: file binary (single-file, geen multipart)
//
//     Response 200: { photoId: Id<"photos"> }
//     Response 400: { error: "Missing X-Upload-Id" }   // ook bij whitespace-only
//     Response 401: { error: "Unauthorized" }
//     Response 403: { error: "Photo limiet bereikt" }  // was 413
//     Response 409: { error: "Upload in progress" }    // race-loser tegen in_progress reservation
//
// Schema (B implementeert — vervangt huidige uploadIdempotency definitie):
//   uploadIdempotency: defineTable({
//     ownerId: v.id("users"),                                // NIEUW: per-user scope
//     clientUploadId: v.string(),
//     status: v.union(v.literal("in_progress"), v.literal("completed")),  // NIEUW
//     photoId: v.optional(v.id("photos")),                   // CHANGED: optioneel, alleen na completion
//     createdAt: v.number(),
//     completedAt: v.optional(v.number()),                   // NIEUW: voor audit
//   })
//     .index("by_owner_and_clientUploadId", ["ownerId", "clientUploadId"])  // NIEUW: composite
//     .index("by_status_and_createdAt", ["status", "createdAt"]);           // NIEUW: voor stale cleanup
//
//   Verwijderd: by_clientUploadId, by_createdAt (vervangen door composite + status-aware indexes).
//
// Server-flow (B implementeert):
//   httpAction handler →
//     auth check (ctx.auth.getUserIdentity()) →
//     resolve users-record →
//     trim + valideer X-Upload-Id →
//     internal.uploads.reserve({ownerId, clientUploadId}) — atomair:
//       lookup by_owner_and_clientUploadId:
//         hit completed → return { kind:"hit", photoId }
//         hit in_progress → return { kind:"conflict" }
//         miss → insert {status:"in_progress", createdAt, photoId:undefined}
//                return { kind:"reserved", reservationId }
//     storage.store(blob) →
//     internal.photos.createFromUploadInternal({...}) — throws "PHOTO_LIMIT_REACHED" bij gate-fail
//     internal.uploads.markCompleted({reservationId, photoId}) — patch status="completed", photoId, completedAt
//     return { photoId }
//
// Bij failure tussen reserve en markCompleted: reservation blijft in_progress,
// stale cleanup-cron ruimt 'm na 5 min op samen met de orphan storage-blob.
// Recordable failure-test (test 6) is geflagd als optioneel.
//
// ──────────────────────────────────────────────────────────────────
// Test-aanpak voor httpActions in convex-test
// ──────────────────────────────────────────────────────────────────
// `t.fetch(path, init)` resolvet de http router uit `convex/http.ts` en
// roept de matching httpAction handler aan met een ge-constructeerde
// Request. Auth propagation: `t.withIdentity(...).fetch(...)` zet
// ctx.auth.getUserIdentity() conform de identity. Geen daadwerkelijke
// JWT-validatie: convex-test trekt geen Authorization-header uit elkaar,
// dus tests voor "auth missing" en "auth invalid" zijn in deze omgeving
// dezelfde test (beide leiden tot identity === null in de handler). In
// productie doet Convex zelf de JWT-validatie vóór de httpAction draait.
// We pinnen daarom de "geen identity → 401" pad één keer; smoke-test in
// fase 4A2 verifieert echte JWT-validatie tegen Clerk.

const FILE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // "JPEG-ish" header bytes
const FILE_BYTES_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // "PNG-ish"

function uploadInit(opts: {
  uploadId?: string;
  body?: BodyInit;
  contentType?: string;
  extraHeaders?: Record<string, string>;
}): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType ?? "image/jpeg",
    ...(opts.uploadId !== undefined ? { "X-Upload-Id": opts.uploadId } : {}),
    ...(opts.extraHeaders ?? {}),
  };
  return {
    method: "POST",
    headers,
    body: opts.body ?? FILE_BYTES,
  };
}

describe("POST /upload — auth", () => {
  it("zonder identity returnt 401", async () => {
    // Convex draait geen JWT-validatie in convex-test; deze test pint dat
    // de handler zelf bij ontbreken van identity een 401 returnt en geen
    // photo record creëert. Reservation pattern: ook geen reservation insert.
    const t = convexTest(schema);

    const res = await t.fetch(
      "/upload",
      uploadInit({ uploadId: "client-uuid-unauth" }),
    );

    expect(res.status).toBe(401);
    const photos = await t.run((ctx) => ctx.db.query("photos").collect());
    expect(photos).toHaveLength(0);
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(0);
  });

  it("identity zonder users-record returnt 401 (of equivalent error-status)", async () => {
    // Auth-laag ziet wel een identity, maar requireCurrentUser-equivalent
    // vindt geen users-record bij subject. Niet-401-status (bv. 500) zou
    // ook acceptabel zijn — pinnen alleen dat het een error is en geen
    // photo wordt gecreëerd. B kiest definitieve status; default = 401.
    const t = convexTest(schema);

    const res = await withUser(t, "user_ghost").fetch(
      "/upload",
      uploadInit({ uploadId: "client-uuid-ghost" }),
    );

    expect(res.ok).toBe(false);
    const photos = await t.run((ctx) => ctx.db.query("photos").collect());
    expect(photos).toHaveLength(0);
  });
});

describe("POST /upload — header validation", () => {
  it("ontbrekende X-Upload-Id returnt 400", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({}), // geen uploadId
    );

    expect(res.status).toBe(400);
    const photos = await t.run((ctx) => ctx.db.query("photos").collect());
    expect(photos).toHaveLength(0);
  });

  it("lege X-Upload-Id (string '') returnt 400", async () => {
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "" }),
    );

    expect(res.status).toBe(400);
  });

  it("whitespace-only X-Upload-Id returnt 400 (na server-side trim)", async () => {
    // Audit-cyclus-1 §3: defensieve trim. Client kan per ongeluk een UUID
    // met leading/trailing whitespace sturen (proxy-rewrites, manual paste).
    // Server moet trim() doen vóór de empty-check, anders glipt "   " door
    // als legitieme idempotency-key.
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    for (const uploadId of ["   ", "\t", "\n", "\t\n  "]) {
      const res = await withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId }),
      );
      expect(res.status).toBe(400);
    }

    const photos = await t.run((ctx) => ctx.db.query("photos").collect());
    expect(photos).toHaveLength(0);
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(0);
  });
});

describe("POST /upload — happy path (reservation flow)", () => {
  it("returnt 200 met photoId, creëert photo + completed reservation, increment photoCount, queue't extractMetadata", async () => {
    // Audit-cyclus-1: reservation eindigt in status="completed" met photoId
    // gevuld + completedAt set + ownerId scoped. Geen post-fact log meer.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    const before = Date.now();
    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({
        uploadId: "client-uuid-happy",
        contentType: "image/jpeg",
      }),
    );
    const after = Date.now();

    expect(res.status).toBe(200);
    const json = (await res.json()) as { photoId: string };
    expect(typeof json.photoId).toBe("string");

    // Photo record gecreëerd
    const photo = await t.run((ctx) =>
      ctx.db.get(json.photoId as Id<"photos">),
    );
    expect(photo).not.toBeNull();
    expect(photo?.ownerId).toBe(aliceId);
    expect(photo?.ratingCount).toBe(0);
    expect(typeof photo?.createdAt).toBe("number");
    expect(photo?.createdAt).toBeGreaterThanOrEqual(before);
    expect(photo?.createdAt).toBeLessThanOrEqual(after);

    // P6 cascade: photoCount++
    const alice = await t.run((ctx) => ctx.db.get(aliceId));
    expect(alice?.photoCount).toBe(1);

    // extractMetadata gequeued
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const extractCalls = scheduled.filter((s) =>
      String(s.name).includes("extractMetadata"),
    );
    expect(extractCalls).toHaveLength(1);

    // Reservation eindstaat: completed, photoId gevuld, ownerId scoped, completedAt set
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(1);
    const r = reservations[0]!;
    expect(r.clientUploadId).toBe("client-uuid-happy");
    expect(r.ownerId).toBe(aliceId);
    expect(r.status).toBe("completed");
    expect(r.photoId).toBe(json.photoId);
    expect(typeof r.completedAt).toBe("number");
    expect(r.completedAt!).toBeGreaterThanOrEqual(before);
    expect(r.completedAt!).toBeLessThanOrEqual(after);
  });

  it("file-content fidelity: storage-blob matcht POST body", async () => {
    // Crucial regression-guard: één van de doelen van de rewrite is dat
    // server controleert wat in storage komt. Pin dat de bytes 1:1 in
    // storage landen (geen multipart-parsing, geen base64-roundtrip-bug).
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({
        uploadId: "client-uuid-fidelity",
        body: FILE_BYTES_2,
        contentType: "image/png",
      }),
    );

    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as { photoId: string };

    // Convex-test kan geen Blob over de t.run-boundary returnen; vergelijking
    // moet binnen de closure gebeuren en een primitive (boolean) terug.
    const matches = await t.run(async (ctx) => {
      const photo = await ctx.db.get(photoId as Id<"photos">);
      if (!photo) return false;
      const stored = await ctx.storage.get(photo.storageId);
      if (!stored) return false;
      const storedBytes = new Uint8Array(await stored.arrayBuffer());
      return Buffer.from(storedBytes).equals(Buffer.from(FILE_BYTES_2));
    });
    expect(matches).toBe(true);
  });

  it("filename + mimeType worden uit Content-Disposition / Content-Type opgepikt indien aanwezig", async () => {
    // Open implementatie-keuze (B beslist): client kan filename meegeven
    // via een header. Voorstel: X-Filename header (eenvoudiger dan parsing
    // van Content-Disposition). MimeType komt uit Content-Type.
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({
        uploadId: "client-uuid-meta",
        contentType: "image/jpeg",
        extraHeaders: { "X-Filename": "vakantie.jpg" },
      }),
    );

    expect(res.status).toBe(200);
    const { photoId } = (await res.json()) as { photoId: string };
    const photo = await t.run((ctx) =>
      ctx.db.get(photoId as Id<"photos">),
    );
    expect(photo?.mimeType).toBe("image/jpeg");
    expect(photo?.filename).toBe("vakantie.jpg");
  });

  it("X-Upload-Id met whitespace rondom de UUID wordt getrimd en idempotent gematcht", async () => {
    // Audit-cyclus-1 §3: dezelfde UUID met en zonder padding moet als één
    // reservation gelden (anders ondermijnt whitespace-noise de retry-safety).
    const t = convexTest(schema);
    await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res1 = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "  uuid-padded  " }),
    );
    expect(res1.status).toBe(200);
    const { photoId: id1 } = (await res1.json()) as { photoId: string };

    const res2 = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "uuid-padded" }),
    );
    expect(res2.status).toBe(200);
    const { photoId: id2 } = (await res2.json()) as { photoId: string };

    expect(id2).toBe(id1);

    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.clientUploadId).toBe("uuid-padded");
  });
});

describe("POST /upload — photo-limit gate (audit-cyclus-1: 403 + typed sentinel)", () => {
  it("user op photoLimit krijgt 403 Forbidden, geen photo record, geen storage object, geen reservation", async () => {
    // Audit-cyclus-1 §1: typed sentinel "PHOTO_LIMIT_REACHED" thrown door
    // createFromUploadInternal i.p.v. fragiele Nederlandse "limiet"-substring
    // match in http handler. Status code 403 (Forbidden, semantisch correcter
    // dan 413 Payload Too Large — limit is een quota, niet body-size).
    // Response body blijft NL voor UX.
    //
    // Limit-check vóór reservation-insert + storage.store. Dat voorkomt:
    //   - orphan storage blobs bij quota-fail
    //   - phantom reservations (in_progress die nooit completen)
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    await t.run(async (ctx) => {
      const u = await ctx.db.get(aliceId);
      await ctx.db.patch(aliceId, { photoCount: u!.photoLimit });
    });

    const res = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "client-uuid-limit" }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Photo limiet bereikt");

    const photos = await t.run((ctx) =>
      ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", aliceId))
        .collect(),
    );
    expect(photos).toHaveLength(0);

    // Reservation niet gepersisteerd — limit-check moet vóór reserve gebeuren,
    // anders blijft een phantom in_progress staan tot stale-cleanup.
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(0);

    // Audit-pin: limiet-check vóór storage.store, anders orphan blob.
    // convex-test heeft geen public storage-list API; deze pin volgt
    // indirect uit "geen photo record" + "blob niet bereikbaar via photo".
  });
});

describe("POST /upload — idempotency (reservation completed → return existing)", () => {
  it("tweede POST met zelfde X-Upload-Id returnt zelfde photoId, geen tweede photo, geen tweede photoCount++, geen tweede extractMetadata", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    const res1 = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "client-uuid-idem" }),
    );
    expect(res1.status).toBe(200);
    const { photoId: id1 } = (await res1.json()) as { photoId: string };

    const res2 = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "client-uuid-idem" }),
    );
    expect(res2.status).toBe(200);
    const { photoId: id2 } = (await res2.json()) as { photoId: string };

    expect(id2).toBe(id1);

    // Geen tweede photo record
    const photos = await t.run((ctx) =>
      ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", aliceId))
        .collect(),
    );
    expect(photos).toHaveLength(1);

    // photoCount slechts één keer geïncrementeerd
    const alice = await t.run((ctx) => ctx.db.get(aliceId));
    expect(alice?.photoCount).toBe(1);

    // extractMetadata slechts één keer gequeued
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const extractCalls = scheduled.filter((s) =>
      String(s.name).includes("extractMetadata"),
    );
    expect(extractCalls).toHaveLength(1);

    // Reservation blijft 1, status="completed"
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.status).toBe("completed");
  });

  it("cross-user same-UUID is structureel gescheiden via composite key (ownerId, clientUploadId)", async () => {
    // Audit-cyclus-1 §2: per-user scope structureel via composite index
    // by_owner_and_clientUploadId. Geen owner-mismatch fallthrough meer
    // (was defensive coding in cyclus 1 om kaping te voorkomen; in cyclus 1
    // zat de bug dat fallthrough wel een nieuwe photo creëerde maar de
    // bestaande reservation behield, waardoor latere replay's gebroken raakten).
    //
    // Nieuwe gedrag: Alice met "shared" en Bob met "shared" zijn twee
    // onafhankelijke reservation-keys, elk in eigen completed-staat.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const bobId = await registerUserWithInvite(t, "user_bob", "b@x.com");

    const res1 = await withUser(t, "user_alice").fetch(
      "/upload",
      uploadInit({ uploadId: "shared-uuid" }),
    );
    expect(res1.status).toBe(200);
    const { photoId: aliceP } = (await res1.json()) as { photoId: string };

    const res2 = await withUser(t, "user_bob").fetch(
      "/upload",
      uploadInit({ uploadId: "shared-uuid" }),
    );
    expect(res2.status).toBe(200);
    const { photoId: bobP } = (await res2.json()) as { photoId: string };

    expect(bobP).not.toBe(aliceP);

    const alicePhoto = await t.run((ctx) =>
      ctx.db.get(aliceP as Id<"photos">),
    );
    const bobPhoto = await t.run((ctx) =>
      ctx.db.get(bobP as Id<"photos">),
    );
    expect(alicePhoto?.ownerId).toBe(aliceId);
    expect(bobPhoto?.ownerId).toBe(bobId);

    // Twee reservations: elk eigen ownerId, elk completed, beide met clientUploadId="shared-uuid"
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(2);
    expect(reservations.every((r) => r.status === "completed")).toBe(true);
    expect(reservations.every((r) => r.clientUploadId === "shared-uuid")).toBe(
      true,
    );
    const ownerIds = reservations.map((r) => r.ownerId).sort();
    expect(ownerIds).toEqual([aliceId, bobId].sort());
  });
});

describe("POST /upload — concurrent uploads", () => {
  it("verschillende users met verschillende X-Upload-Ids: elk eigen photoId", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");
    const bobId = await registerUserWithInvite(t, "user_bob", "b@x.com");

    const [res1, res2] = await Promise.all([
      withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId: "alice-1" }),
      ),
      withUser(t, "user_bob").fetch(
        "/upload",
        uploadInit({ uploadId: "bob-1" }),
      ),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const { photoId: aliceP } = (await res1.json()) as { photoId: string };
    const { photoId: bobP } = (await res2.json()) as { photoId: string };
    expect(aliceP).not.toBe(bobP);

    const alicePhoto = await t.run((ctx) =>
      ctx.db.get(aliceP as Id<"photos">),
    );
    const bobPhoto = await t.run((ctx) =>
      ctx.db.get(bobP as Id<"photos">),
    );
    expect(alicePhoto?.ownerId).toBe(aliceId);
    expect(bobPhoto?.ownerId).toBe(bobId);
  });

  it("zelfde user, twee verschillende X-Upload-Ids parallel: twee photoIds, photoCount=2", async () => {
    // Pieterpad-scenario: één user maakt op zijn telefoon snel 2 foto's,
    // beide uploads vuren parallel. Elke heeft eigen client-UUID; beide
    // moeten slagen met eigen photoId, photoCount=2.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    const [res1, res2] = await Promise.all([
      withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId: "alice-A" }),
      ),
      withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId: "alice-B" }),
      ),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const { photoId: pA } = (await res1.json()) as { photoId: string };
    const { photoId: pB } = (await res2.json()) as { photoId: string };
    expect(pA).not.toBe(pB);

    const alice = await t.run((ctx) => ctx.db.get(aliceId));
    expect(alice?.photoCount).toBe(2);

    const photos = await t.run((ctx) =>
      ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", aliceId))
        .collect(),
    );
    expect(photos).toHaveLength(2);
  });

  // Skip-rationale (B, audit-cyclus-1 implementatie):
  // convex-test's TransactionManager serialiseert mutations via een global
  // lock (_waitOnCurrentFunction). Onder Promise.all + httpAction krijgt
  // ctx.storage.store een race op de _writes-stack: Handler1's reserve geeft
  // de lock vrij, Handler2's reserve wacht in de queue, en wanneer Handler1
  // daarna ctx.storage.store doet ziet writeToDatabase (line 1206-1216 in
  // convex-test/dist/index.js) een lege writes-stack en throw't "Write outside
  // of transaction".
  //
  // Dit is een simulator-quirk, geen bug in onze reservation pattern:
  //   - In productie zijn Convex mutations transactioneel met OCC. De reserve
  //     mutation is enige write-pad voor de uniqueness-key (ownerId,
  //     clientUploadId): twee parallelle handlers triggeren een transactie-
  //     conflict, de loser retry'd, ziet bij retry de in_progress reservation
  //     en returnt {kind:"conflict"} → 409.
  //   - Sequential idempotency (test 7) bewijst de happy-path semantiek
  //   - Sequential cross-user (test 8 in idempotency-suite) bewijst per-user
  //     scope via composite index
  //
  // TODO (post-cyclus 1): pin race-gedrag in productie via integration smoke-test
  // tegen echte Convex deployment, of via een convex-test patch / vendored fix.
  it.skip("zelfde user + zelfde X-Upload-Id parallel: één wint (200 + photoId), ander verliest (409 Conflict). Photo-count exact 1.", async () => {
    // Audit-cyclus-1 §1 (kritiek): reservation pattern moet de race-conditie
    // dichten. Promise.all met twee POSTs op (alice, "race-uuid") triggert
    // beide handlers tegelijk:
    //   - Beide doen `uploads.reserve` lookup → zien geen bestaand record
    //   - Beide proberen reservation insert (status=in_progress)
    //   - Convex transaction-conflict detection: één commit slaagt, andere
    //     wordt ge-retry'd. Op retry ziet hij in_progress reservation van
    //     de winnaar → handler returnt 409 Conflict
    //   - Winnaar gaat door met storage.store + photo-create + markCompleted
    //
    // Eindtoestand: 1 photo, photoCount=1, 1 reservation (completed),
    // 1 extractMetadata schedule. De 409-loser laat geen sporen achter.
    //
    // Open vraag voor B: convex-test serialiseert mutations strikt; de
    // race kan in test-context opgelost zijn vóór beide handlers de DB
    // raken. Als convex-test géén race triggert (beide returnen 200 met
    // verschillende photoIds) → reservation pattern is niet retry-safe in
    // productie en moet sterker (bv. via een dedupe-mutation die zelf de
    // optimistic-concurrency conflict afhandelt en de loser explicit naar
    // 409 stuurt). Test mag dan geel/skip met expliciete TODO; niet stilletjes
    // groen-laten.
    const t = convexTest(schema);
    const aliceId = await registerUserWithInvite(t, "user_alice", "a@x.com");

    const [res1, res2] = await Promise.all([
      withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId: "race-uuid" }),
      ),
      withUser(t, "user_alice").fetch(
        "/upload",
        uploadInit({ uploadId: "race-uuid" }),
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Identificeer de winnaar voor verdere assertions
    const winner = res1.status === 200 ? res1 : res2;
    const { photoId } = (await winner.json()) as { photoId: string };
    expect(typeof photoId).toBe("string");

    // Eén photo record voor alice
    const photos = await t.run((ctx) =>
      ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", aliceId))
        .collect(),
    );
    expect(photos).toHaveLength(1);
    expect(photos[0]?._id).toBe(photoId);

    // photoCount exact 1
    const alice = await t.run((ctx) => ctx.db.get(aliceId));
    expect(alice?.photoCount).toBe(1);

    // Eén extractMetadata schedule (niet twee)
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const extractCalls = scheduled.filter((s) =>
      String(s.name).includes("extractMetadata"),
    );
    expect(extractCalls).toHaveLength(1);

    // Eén reservation, status=completed, photoId gevuld
    const reservations = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.status).toBe("completed");
    expect(reservations[0]?.photoId).toBe(photoId);
  });
});
