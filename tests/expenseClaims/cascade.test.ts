import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { seedMember } from "../_helpers/membership";
import { deleteAccount } from "../_helpers/deleteAccount";
import {
  as,
  claimRows,
  claimsApi,
  claimsOk,
  configureClaims,
  expectCode,
  newDraft,
  newSubmitted,
  newT,
  processClaim,
  seedWorld,
  useClaimsEnv,
  type T,
} from "./_claims";

// WP45 §A11 — cascade.
//   M6 (besluit 3): uit de groep → zijn concepten in die groep weg; verzonden
//     declaraties blijven voor het clubboek; het lid ziet ze niet meer en kan
//     niet meer intrekken.
//   U19 (besluit 4): account weg → al zijn declaraties weg, elke status, elke groep.
//   G7 (draft-invariant 13): groep weg → haar declaraties weg, ook bij M2-e.
//   A-keuze 13 (open vraag 1): wie terugkomt, ziet zijn verzonden declaraties weer.

useClaimsEnv();

/**
 * In De Heeren: alice een concept, een verzonden en een verwerkte declaratie;
 * bob een concept en een verzonden. In Ander (via een andere CLAIMS_GROUP_ID):
 * alice een concept en een verzonden.
 */
async function world(t: T) {
  const w = await seedWorld(t);
  const a = {
    draft: await newDraft(as.alice(t), w.groups.club, { title: "Concept alice" }),
    sent: await newSubmitted(as.alice(t), w.groups.club, { title: "Verzonden alice" }),
    done: await newSubmitted(as.alice(t), w.groups.club, { title: "Verwerkt alice" }),
  };
  await processClaim(t, a.done);
  const b = {
    draft: await newDraft(as.bob(t), w.groups.club, { title: "Concept bob" }),
    sent: await newSubmitted(as.bob(t), w.groups.club, { title: "Verzonden bob" }),
  };
  configureClaims(w.groups.other);
  const o = {
    draft: await newDraft(as.alice(t), w.groups.other, { title: "Concept alice elders" }),
    sent: await newSubmitted(as.alice(t), w.groups.other, { title: "Verzonden alice elders" }),
  };
  configureClaims(w.groups.club);
  return { w, a, b, o };
}

const ids = async (t: T) => (await claimRows(t)).map((r) => r._id as string).sort();

describe("M6 en besluit 3: uit de groep", () => {
  it("zelf vertrekken: zijn concepten in die groep weg, de rest blijft; anderen en andere groepen blijven", async () => {
    const t = newT();
    const { w, a, b, o } = await world(t);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    expect(await ids(t)).toEqual([a.sent, a.done, b.draft, b.sent, o.draft, o.sent].sort());
    expect((await claimsOk(t)).map((c) => c.id).sort()).toEqual([a.sent, a.done, b.sent].sort());
  });

  it("eruit gezet door een admin: hetzelfde", async () => {
    const t = newT();
    const { w, a, b, o } = await world(t);
    await as.bob(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    expect(await ids(t)).toEqual([a.sent, a.done, b.draft, b.sent, o.draft, o.sent].sort());
  });

  it("daarna ziet hij ze niet en kan hij niet intrekken: NOT_MEMBER", async () => {
    const t = newT();
    const { w, a } = await world(t);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    await expectCode(as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club }), "NOT_MEMBER");
    await expectCode(as.alice(t).mutation(claimsApi.withdraw, { claimId: a.sent }), "NOT_MEMBER");
    await expectCode(as.alice(t).mutation(claimsApi.withdraw, { claimId: a.done }), "NOT_MEMBER");
  });

  it("A-keuze 13 (open vraag 1): wie terugkomt, ziet zijn verzonden declaraties weer, zonder de concepten", async () => {
    const t = newT();
    const { w, a } = await world(t);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    await seedMember(t, { groupId: w.groups.club, userId: w.users.alice });
    const mine = await as.alice(t).query(claimsApi.listMine, { groupId: w.groups.club });
    expect(mine.map((m) => m._id).sort()).toEqual([a.sent, a.done].sort());
    await as.alice(t).mutation(claimsApi.withdraw, { claimId: a.sent });
  });
});

describe("U19 en besluit 4: account weg", () => {
  it("al zijn declaraties weg (elke status, elke groep); die van anderen blijven", async () => {
    const t = newT();
    const { b } = await world(t);
    await deleteAccount(t, as.alice(t));
    expect(await ids(t)).toEqual([b.draft, b.sent].sort());
    expect((await claimsOk(t)).map((c) => c.id)).toEqual([b.sent]);
  });

  it("ook een declaratie van een groep die hij eerder verliet", async () => {
    const t = newT();
    const { w, b } = await world(t);
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.club, userId: w.users.alice });
    await deleteAccount(t, as.alice(t));
    expect(await ids(t)).toEqual([b.draft, b.sent].sort());
  });
});

describe("G7 en draft-invariant 13: groep weg", () => {
  it("groups.remove: alle declaraties van de groep weg; die van een andere groep blijven", async () => {
    const t = newT();
    const { w, o } = await world(t);
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    expect(await ids(t)).toEqual([o.draft, o.sent].sort());
  });

  it("M2-e: het laatste lid verwijdert zijn account; ook de declaraties van wie eerder vertrok gaan mee", async () => {
    const t = newT();
    const { w, a, b } = await world(t);
    // alice vertrekt uit Ander; haar verzonden declaratie daar blijft (besluit 3).
    await as.alice(t).mutation(api.groups.removeMember, { groupId: w.groups.other, userId: w.users.alice });
    await deleteAccount(t, as.dave(t));
    expect(await t.run((ctx) => ctx.db.get(w.groups.other))).toBeNull();
    expect(await ids(t)).toEqual([a.draft, a.sent, a.done, b.draft, b.sent].sort());
  });
});
