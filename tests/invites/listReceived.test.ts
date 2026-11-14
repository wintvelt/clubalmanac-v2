import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, goneGroupId, newT } from "../groups/_beheer";
import { SCHOON } from "../_helpers/jpeg";
import { allKeys, DAY_MS, secondGroup, seedCover, seedInvite, world } from "./_wp19b";

// WP19b invariant 6, A-invariant 6, 14, 15 en 16: een bestaand lid ziet zijn
// ontvangen uitnodigingen. Alleen die nu accepteerbaar zijn: open, niet
// verlopen, groep bestaat, uitnodiger nog admin, voor het eigen adres. Nieuwste
// eerst. Per uitnodiging alleen: id, rol, geldig tot, bericht, groep (`_id`,
// naam, `hasCover`), uitnodiger (`_id`, naam, avatar-velden). Geen token, geen
// e-mailadres, geen `invitedBy`, geen naam die de admin typte, geen foto-id of
// storageId.

const listReceived = api.invites.listReceived;
type R = Record<string, unknown>;

const TOP_KEYS = ["_id", "role", "expiresAt", "message", "group", "inviter"];
// WP19c A-invariant 12: `coverOrientation` erbij (tests/invites/listReceivedOrientation.test.ts).
const GROUP_KEYS = ["_id", "name", "hasCover", "coverOrientation"];
const INVITER_KEYS = ["_id", "name", "profileOrientation", "profileHasFormats", "profileVersion"];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("A-invariant 6 — welke uitnodigingen", () => {
  it("alleen de accepteerbare uitnodigingen voor het eigen adres", async () => {
    const t = newT();
    const w = await world(t);
    const good = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: Date.now() });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, status: "declined" });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, status: "accepted" });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, status: "expired" });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: await goneGroupId(t) });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.lex!, groupId: w.groupId });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga! });
    await seedInvite(t, { email: "eve@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect(got.map((i) => i._id)).toEqual([good]);
  });

  it("nieuwste eerst", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    const now = Date.now();
    const older = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, createdAt: now - 2 * DAY_MS });
    const newer = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: g2, createdAt: now - DAY_MS });
    const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect(got.map((i) => i._id)).toEqual([newer, older]);
  });

  it("anoniem en zonder users-rij: lege lijst", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: "nieuw@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    expect(await t.query(listReceived, {})).toEqual([]);
    expect(await as(t, "user_nieuw").query(listReceived, {})).toEqual([]);
  });
});

describe("A-invariant 6, 14, 15 — de vorm (veld-whitelist)", () => {
  it("precies de toegestane velden, met de juiste waarden", async () => {
    const t = newT();
    const w = await world(t);
    const expiresAt = Date.now() + 5 * DAY_MS;
    const id = await seedInvite(t, {
      email: "bob@x.test",
      invitedBy: w.users.olga!,
      groupId: w.groupId,
      role: "admin",
      expiresAt,
      name: "Bobje",
      message: "Kom erbij!",
    });
    const [item] = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect(item).toBeDefined();
    for (const k of Object.keys(item!)) expect(TOP_KEYS).toContain(k);
    for (const k of Object.keys(item!.group as R)) expect(GROUP_KEYS).toContain(k);
    for (const k of Object.keys(item!.inviter as R)) expect(INVITER_KEYS).toContain(k);
    expect(item).toMatchObject({
      _id: id,
      role: "admin",
      expiresAt,
      message: "Kom erbij!",
      group: { _id: w.groupId, name: "Club", hasCover: false },
      inviter: { _id: w.users.olga, name: "olga" },
    });
  });

  it("geen token, geen e-mailadres, geen invitedBy, geen getypte naam, geen tijden van anderen", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, {
      email: "bob@x.test",
      invitedBy: w.users.olga!,
      groupId: w.groupId,
      name: "Bobje",
      message: "Hoi",
    });
    const token = (await t.run(async (ctx) => ctx.db.get(id)))!.token;
    const got = await as(t, "user_bob").query(listReceived, {});
    const json = JSON.stringify(got);
    expect(json).not.toContain(token);
    expect(json).not.toContain("@x.test");
    expect(json).not.toContain("Bobje");
    const keys = allKeys(got);
    for (const forbidden of ["token", "email", "invitedBy", "createdAt", "respondedAt", "bouncedAt", "status"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("zonder bericht: geen message-veld", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const [item] = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect(item).not.toHaveProperty("message");
  });
});

describe("A-invariant 15 — hasCover, zonder foto-id", () => {
  it("cover gezet en in een album van de groep: hasCover true; geen foto-id of storageId in de response", async () => {
    const t = newT();
    const w = await world(t);
    const { photoId } = await seedCover(t, w, { bytes: SCHOON });
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect((got[0]!.group as R).hasCover).toBe(true);
    const storageId = (await t.run(async (ctx) => ctx.db.get(photoId)))!.storageId;
    const json = JSON.stringify(got);
    expect(json).not.toContain(photoId);
    expect(json).not.toContain(storageId);
    expect(allKeys(got)).not.toContain("coverPhotoId");
    expect(allKeys(got)).not.toContain("cover");
  });

  it("cover die niet (meer) in een album van de groep staat: hasCover false", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    // Een foto die alleen in een album van een andere groep staat.
    const { photoId } = await seedCover(t, w, { bytes: SCHOON, groupId: g2 });
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { coverPhotoId: photoId }));
    await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const got = (await as(t, "user_bob").query(listReceived, {})) as R[];
    expect((got[0]!.group as R).hasCover).toBe(false);
  });
});
