import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asUser,
  expectRejectedNoChange,
  newAccount,
  newT,
  seedWorld,
  useWebmasterEnv,
  type T,
} from "./_helpers";

// WP24 A-keuze 5 (ter bevestiging; regie kan dit bestand schrappen als het
// naar een eigen WP gaat): invariant 1 geldt ook voor het beeld, niet alleen
// voor de foto-rij. De foto-vorm bevat `storageId`, dus een ex-lid kent het
// beeld-id van foto's die hij ooit zag.
//
// - photos.create koppelt geen storageId die al bij een foto van een ander
//   hoort aan een nieuwe foto-rij (anders: eigenaar van andermans beeld, en
//   daarmee ook een omweg om A-keuze 1).
// - users.updateProfile zet geen profielfoto op het beeld van een foto
//   waar de caller geen foto-toegang toe heeft (v1: profielfoto = foto met
//   toegang).
//
// photos.create wordt via een losse referentie aangeroepen: als B hem intern
// maakt, faalt de call ook, en dat is net zo goed.

useWebmasterEnv();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photosCreate = (api.photos as Record<string, any>).create;

async function storageOf(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => (await ctx.db.get(photoId))!.storageId);
}

describe("A-keuze 5 — photos.create hergebruikt geen beeld van een ander", () => {
  it("vers account met de storageId van een gepubliceerde foto: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const storageId = await storageOf(t, w.photos.pAlice);
    await expectRejectedNoChange(t, () => client.mutation(photosCreate, { storageId }));
  });

  it("ex-lid met de storageId van een foto die hij ooit zag: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const dave = asUser(t, w, "dave");
    const seen = (await dave.query(api.photos.getById, { photoId: w.photos.pAlice })) as {
      storageId: Id<"_storage">;
    };
    await dave.mutation(api.groups.removeMember, {
      groupId: w.groups.G3,
      userId: w.users.dave.id,
    });
    await expectRejectedNoChange(t, () =>
      dave.mutation(photosCreate, { storageId: seen.storageId }),
    );
  });

  it("lid mét foto-toegang maakt geen eigen foto-rij op andermans beeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const storageId = await storageOf(t, w.photos.pAlice);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "bob").mutation(photosCreate, { storageId }),
    );
  });
});

describe("A-keuze 5 — users.updateProfile zet geen profielfoto op een beeld zonder toegang", () => {
  it("vers account met de storageId van een foto van een ander: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      const storageId = await storageOf(t, photoId);
      await expectRejectedNoChange(
        t,
        () => client.mutation(api.users.updateProfile, { profilePhotoStorageId: storageId }),
        `profielfoto ${photoId}`,
      );
    }
  });

  it("controle: een nieuw geüpload beeld als profielfoto mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { id, client } = await newAccount(t, "mallory");
    const fresh = await t.run(async (ctx) => ctx.storage.store(new Blob(["nieuw"])));
    await client.mutation(api.users.updateProfile, { profilePhotoStorageId: fresh });
    const u = await t.run(async (ctx) => ctx.db.get(id));
    expect(u?.profilePhotoStorageId).toBe(fresh);
    void w;
  });

  it("controle: het beeld van een eigen foto als profielfoto mag", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const storageId = await storageOf(t, w.photos.pAlice);
    await asUser(t, w, "alice").mutation(api.users.updateProfile, {
      profilePhotoStorageId: storageId,
    });
    const u = await t.run(async (ctx) => ctx.db.get(w.users.alice.id));
    expect(u?.profilePhotoStorageId).toBe(storageId);
  });
});
