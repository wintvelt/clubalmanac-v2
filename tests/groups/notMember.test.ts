import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// WP16 invarianten 5 en 9 (A-beslissing 6). De reads achter het Groep-scherm
// geven bij "geen lid" en bij "groep bestaat niet" precies dezelfde
// ConvexError met code NOT_MEMBER. De app herkent de fout aan de code: een
// gewone Error komt in productie aan als "Server Error", zonder tekst. Eén
// uitkomst voor beide gevallen, dus geen bestaans-orakel (WP23).
//
// Ook live: wie uit de groep verdwijnt terwijl het scherm open is, krijgt bij
// de volgende uitvoering van de query dezelfde fout.

type T = ReturnType<typeof convexTest>;

const READS = [
  ["groups.getById", (t: T, s: string, groupId: Id<"groups">) =>
    withUser(t, s).query(api.groups.getById, { groupId })],
  ["groups.getWithCover", (t: T, s: string, groupId: Id<"groups">) =>
    withUser(t, s).query(api.groups.getWithCover, { groupId })],
  ["groups.listMembers", (t: T, s: string, groupId: Id<"groups">) =>
    withUser(t, s).query(api.groups.listMembers, { groupId })],
  ["albums.listByGroup", (t: T, s: string, groupId: Id<"groups">) =>
    withUser(t, s).query(api.albums.listByGroup, { groupId })],
  ["albums.listByGroupWithUnread", (t: T, s: string, groupId: Id<"groups">) =>
    withUser(t, s).query(api.albums.listByGroupWithUnread, { groupId })],
] as const;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("de aanroep had moeten falen");
}

async function expectNotMember(promise: Promise<unknown>): Promise<unknown> {
  const err = await caught(promise);
  expect(err).toBeInstanceOf(ConvexError);
  const data = (err as ConvexError<{ code: string }>).data;
  expect(data).toMatchObject({ code: "NOT_MEMBER" });
  return data;
}

async function setup(t: T) {
  const adminId = await registerUser(t, "user_admin", "admin@x.com", "Admin");
  const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  await registerUser(t, "user_eve", "eve@x.com", "Eve");
  const groupId = await withUser(t, "user_admin").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId, userId: bobId });
  await withUser(t, "user_admin").mutation(api.albums.create, { groupId, name: "A" });
  return { adminId, bobId, groupId };
}

// Een geldig id van een groep die niet (meer) bestaat.
async function goneGroupId(t: T): Promise<Id<"groups">> {
  const id = await withUser(t, "user_eve").mutation(api.groups.create, { name: "Weg" });
  await withUser(t, "user_eve").mutation(api.groups.remove, { groupId: id });
  return id;
}

describe.each(READS)("%s: NOT_MEMBER", (_name, read) => {
  it("een lid krijgt gewoon antwoord", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await setup(t);
    await expect(read(t, "user_bob", groupId)).resolves.toBeDefined();
  });

  it("geen lid: ConvexError met code NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await setup(t);
    await expectNotMember(read(t, "user_eve", groupId));
  });

  it("onbekende groep: dezelfde fout als geen lid (geen orakel)", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await setup(t);
    const gone = await goneGroupId(t);
    const notMember = await expectNotMember(read(t, "user_eve", groupId));
    const unknown = await expectNotMember(read(t, "user_eve", gone));
    expect(unknown).toEqual(notMember);
  });

  it("uit de groep gehaald terwijl je kijkt: de volgende uitvoering geeft NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { bobId, groupId } = await setup(t);
    await expect(read(t, "user_bob", groupId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.groups.removeMember, { groupId, userId: bobId });
    await expectNotMember(read(t, "user_bob", groupId));
  });

  it("zelf vertrokken: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { bobId, groupId } = await setup(t);
    await withUser(t, "user_bob").mutation(api.groups.removeMember, { groupId, userId: bobId });
    await expectNotMember(read(t, "user_bob", groupId));
  });

  it("groep verwijderd terwijl je kijkt: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await setup(t);
    await expect(read(t, "user_bob", groupId)).resolves.toBeDefined();
    await withUser(t, "user_admin").mutation(api.groups.remove, { groupId });
    await expectNotMember(read(t, "user_bob", groupId));
  });
});
