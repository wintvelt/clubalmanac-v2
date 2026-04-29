import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// FL2 — list-queries voor flag flow.
// Bron 1: blob-images-api-photos/handlersPhoto/listFlagged.js (regel 5-10)
//   - eigen photos die door anderen geflagged zijn (filter !!flaggedDate)
// Bron 2: blob-images-api-photos/handlersPhoto/listAllFlagged.js (regel 5-23)
//   - webmaster-only queue van alle geflagde photos (oude code returnde
//     {isWebmaster:false} voor non-webmaster; v2 gooit error — gat met oude
//     gedrag, gemarkeerd [GAP] hieronder)

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
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
  return await withUser(t, subject, email).mutation(api.users.register, {
    email,
  });
}

async function uploadStorage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

describe("photos.listMyFlagged", () => {
  // listFlagged.js regel 8-9: photos.filter(p => !!p.flaggedDate)
  it("returnt alleen eigen photos die geflagged zijn", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const flaggedPhoto = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId: s1 },
    );
    const cleanPhoto = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId: s2 },
    );

    await withUser(t, "user_bob").mutation(api.photos.flag, {
      photoId: flaggedPhoto,
    });

    const result = await withUser(t, "user_alice").query(
      api.photos.listMyFlagged,
      {},
    );

    const ids = result.map((p: { _id: string }) => p._id);
    expect(ids).toContain(flaggedPhoto);
    expect(ids).not.toContain(cleanPhoto);
  });

  it("returnt geen photos van andere users (zelfs als zij ook flagged zijn)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const alicePhoto = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId: s1 },
    );
    const bobPhoto = await withUser(t, "user_bob").mutation(
      api.photos.create,
      { storageId: s2 },
    );

    await withUser(t, "user_bob").mutation(api.photos.flag, {
      photoId: alicePhoto,
    });
    await withUser(t, "user_alice").mutation(api.photos.flag, {
      photoId: bobPhoto,
    });

    const aliceResult = await withUser(t, "user_alice").query(
      api.photos.listMyFlagged,
      {},
    );
    const aliceIds = aliceResult.map((p: { _id: string }) => p._id);
    expect(aliceIds).toContain(alicePhoto);
    expect(aliceIds).not.toContain(bobPhoto);
  });

  it("returnt lege array als user geen geflagde photos heeft", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const result = await withUser(t, "user_alice").query(
      api.photos.listMyFlagged,
      {},
    );
    expect(result).toEqual([]);
  });
});

describe("photos.listAllFlagged — webmaster gated", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // listAllFlagged.js regel 7-8: webmaster check
  // [GAP] oude code returned {isWebmaster:false}; v2 throwt
  it("non-webmaster krijgt error", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    await expect(
      withUser(t, "user_alice", "a@x.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).rejects.toThrow();
  });

  it("webmaster ziet alle geflagde photos van alle users", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);

    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const s3 = await uploadStorage(t);
    const alicePhoto = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId: s1 },
    );
    const bobPhoto = await withUser(t, "user_bob").mutation(
      api.photos.create,
      { storageId: s2 },
    );
    const carolPhotoUnflagged = await withUser(t, "user_carol").mutation(
      api.photos.create,
      { storageId: s3 },
    );

    await withUser(t, "user_bob").mutation(api.photos.flag, {
      photoId: alicePhoto,
    });
    await withUser(t, "user_alice").mutation(api.photos.flag, {
      photoId: bobPhoto,
    });

    const result = await withUser(t, "user_wm", WEBMASTER_EMAIL).query(
      api.photos.listAllFlagged,
      {},
    );
    const ids = result.map((p: { _id: string }) => p._id);
    expect(ids).toContain(alicePhoto);
    expect(ids).toContain(bobPhoto);
    expect(ids).not.toContain(carolPhotoUnflagged);
  });
});
