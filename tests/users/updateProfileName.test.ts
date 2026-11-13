import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { NAME_MAX_LENGTH } from "../../convex/lib/constants";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// WP15b invarianten 1, 9 en 10, A-punt 3: de backend bewaakt de naam. Een
// ongeldige naam geeft een ConvexError met een code (een gewone Error komt in
// productie aan als "Server Error", zonder tekst). Er wordt dan niets bewaard.

type T = ReturnType<typeof convexTest>;

async function setup(name?: string) {
  const t = convexTest(schema, modules);
  const id = await registerUser(t, "user_alice", "alice@x.com", name);
  return { t, id, as: withUser(t, "user_alice") };
}

async function nameOf(t: T, id: Id<"users">) {
  return (await t.run((ctx) => ctx.db.get(id)))?.name;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "de aanroep had moeten falen").toBeInstanceOf(ConvexError);
  expect((err as ConvexError<{ code: string }>).data).toMatchObject({ code });
}

describe("NAME_MAX_LENGTH", () => {
  it("is 50", () => {
    expect(NAME_MAX_LENGTH).toBe(50);
  });
});

describe("updateProfile — geldige namen", () => {
  it.each([
    "Jan",
    "Wouter In 't Velt",
    "José-María Ñúñez",
    "Zoë",
    "李小龙",
    "Jan 🎉",
    "<b>Jan</b>",
    "👨\u200d👩\u200d👧", // met U+200D (ZWJ): mag
  ])("%s wordt bewaard zoals getypt", async (name) => {
    const { t, id, as } = await setup("Oud");
    await as.mutation(api.users.updateProfile, { name });
    expect(await nameOf(t, id)).toBe(name);
  });

  it("spaties aan begin en eind worden weggehaald, ook vaste spaties", async () => {
    const { t, id, as } = await setup("Oud");
    await as.mutation(api.users.updateProfile, { name: "  \u00a0Jan Piet \u3000 " });
    expect(await nameOf(t, id)).toBe("Jan Piet");
  });

  it("precies 50 tekens mag", async () => {
    const { t, id, as } = await setup("Oud");
    const name = "a".repeat(50);
    await as.mutation(api.users.updateProfile, { name });
    expect(await nameOf(t, id)).toBe(name);
  });

  it("50 tekens na het weghalen van spaties mag", async () => {
    const { t, id, as } = await setup("Oud");
    await as.mutation(api.users.updateProfile, { name: `   ${"a".repeat(50)}   ` });
    expect(await nameOf(t, id)).toBe("a".repeat(50));
  });

  it("tekens tellen, geen UTF-16-eenheden: 50 emoji mag", async () => {
    const { t, id, as } = await setup("Oud");
    const name = "😀".repeat(50);
    await as.mutation(api.users.updateProfile, { name });
    expect(await nameOf(t, id)).toBe(name);
  });

  it("dezelfde naam opnieuw opslaan mag", async () => {
    const { t, id, as } = await setup("Jan");
    await as.mutation(api.users.updateProfile, { name: "Jan" });
    expect(await nameOf(t, id)).toBe("Jan");
  });
});

describe("updateProfile — NAME_EMPTY", () => {
  it.each([
    ["leeg", ""],
    ["alleen spaties", "    "],
    ["alleen een tab", "\t"],
    ["alleen een enter", "\n"],
    ["alleen vaste spaties", "\u00a0\u3000"],
  ])("%s: geweigerd, naam ongewijzigd", async (_label, name) => {
    const { t, id, as } = await setup("Oud");
    await expectCode(as.mutation(api.users.updateProfile, { name }), "NAME_EMPTY");
    expect(await nameOf(t, id)).toBe("Oud");
  });
});

describe("updateProfile — NAME_TOO_LONG", () => {
  it("51 tekens: geweigerd, naam ongewijzigd", async () => {
    const { t, id, as } = await setup("Oud");
    await expectCode(
      as.mutation(api.users.updateProfile, { name: "a".repeat(51) }),
      "NAME_TOO_LONG",
    );
    expect(await nameOf(t, id)).toBe("Oud");
  });

  it("51 emoji: geweigerd", async () => {
    const { as } = await setup("Oud");
    await expectCode(
      as.mutation(api.users.updateProfile, { name: "😀".repeat(51) }),
      "NAME_TOO_LONG",
    );
  });

  it("te lang gaat vóór verboden tekens (volgorde van de checks)", async () => {
    const { as } = await setup("Oud");
    await expectCode(
      as.mutation(api.users.updateProfile, { name: `${"a".repeat(51)}\u0007` }),
      "NAME_TOO_LONG",
    );
  });
});

describe("updateProfile — NAME_INVALID", () => {
  it.each([
    ["NUL", "Jan\u0000Piet"],
    ["bel", "Jan\u0007"],
    ["tab binnenin", "Jan\tPiet"],
    ["enter binnenin", "Jan\nPiet"],
    ["carriage return", "Jan\rPiet"],
    ["DEL", "Jan\u007fPiet"],
    ["C1-controleteken", "Jan\u0085Piet"],
    ["regelscheiding", "Jan\u2028Piet"],
    ["alineascheiding", "Jan\u2029Piet"],
    ["LRM", "Jan\u200ePiet"],
    ["RLM", "Jan\u200fPiet"],
    ["RLO (leesrichting om)", "Jan\u202eteiP"],
    ["LRE", "Jan\u202aPiet"],
    ["RLI", "Jan\u2067Piet"],
    ["PDI", "Jan\u2069Piet"],
    ["zero-width space", "Jan\u200bPiet"],
    ["alleen een zero-width space", "\u200b"],
    ["BOM binnenin (aan de rand haalt trim hem weg)", "Ja\ufeffn"],
  ])("%s: geweigerd, naam ongewijzigd", async (_label, name) => {
    const { t, id, as } = await setup("Oud");
    await expectCode(as.mutation(api.users.updateProfile, { name }), "NAME_INVALID");
    expect(await nameOf(t, id)).toBe("Oud");
  });

  it("U+200C (ZWNJ) mag", async () => {
    const { t, id, as } = await setup("Oud");
    await as.mutation(api.users.updateProfile, { name: "می\u200cخواهم" });
    expect(await nameOf(t, id)).toBe("می\u200cخواهم");
  });
});

describe("updateProfile — een geweigerde naam verandert niets (invariant 9)", () => {
  it("ook de profielfoto in dezelfde aanroep wordt niet bewaard", async () => {
    const { t, id, as } = await setup("Oud");
    // Een beeld dat de caller mag gebruiken: een eigen foto (WP24 invariant 8).
    const storageId = await t.run(async (ctx) => {
      const sid = await ctx.storage.store(new Blob(["x"]));
      await ctx.db.insert("photos", {
        ownerId: id,
        storageId: sid,
        createdAt: Date.now(),
      });
      return sid;
    });
    await expectCode(
      as.mutation(api.users.updateProfile, { name: "   ", profilePhotoStorageId: storageId }),
      "NAME_EMPTY",
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.name).toBe("Oud");
    expect(row?.profilePhotoStorageId).toBeUndefined();
  });
});

describe("updateProfile — gemigreerde namen", () => {
  it("een aanroep zonder name checkt de bestaande naam niet", async () => {
    const legacy = "  Oude\tNaam  ";
    const { t, id, as } = await setup(legacy);
    const storageId = await t.run(async (ctx) => {
      const sid = await ctx.storage.store(new Blob(["x"]));
      await ctx.db.insert("photos", {
        ownerId: id,
        storageId: sid,
        createdAt: Date.now(),
      });
      return sid;
    });
    await as.mutation(api.users.updateProfile, { profilePhotoStorageId: storageId });
    expect(await nameOf(t, id)).toBe(legacy);
  });

  it("users.current geeft de gemigreerde naam ongewijzigd terug", async () => {
    const legacy = "  Oude\tNaam  ";
    const { as } = await setup(legacy);
    const me = await as.query(api.users.current, {});
    expect(me?.name).toBe(legacy);
  });

  it("een lege aanroep verandert niets", async () => {
    const { t, id, as } = await setup("Oud");
    await as.mutation(api.users.updateProfile, {});
    expect(await nameOf(t, id)).toBe("Oud");
  });
});

describe("updateProfile — andere leden zien de nieuwe naam (invariant 2)", () => {
  it("users.getById voor een medelid toont de nieuwe, getrimde naam", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "user_admin", "admin@x.com", "Admin");
    const aliceId = await registerUser(t, "user_alice", "alice@x.com", "Alice");
    const groupId = await withUser(t, "user_admin").mutation(api.groups.create, { name: "G" });
    await seedMember(t, { groupId, userId: aliceId });

    await withUser(t, "user_alice").mutation(api.users.updateProfile, { name: "  Alice 2 " });
    const seen = await withUser(t, "user_admin").query(api.users.getById, { userId: aliceId });
    expect(seen.name).toBe("Alice 2");
  });
});
