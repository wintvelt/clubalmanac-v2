// WP17d — gedeelde opbouw voor de locatie-tests.
//
// De functies van WP17d bestaan nog niet als B begint. De referenties lopen
// daarom via `A` (api, zonder type): pre-impl zijn ze undefined en faalt de
// aanroep (RED om de goede reden), na de impl typecheckt alles gewoon.
//
// Wereld:
//   groep G: Owen (admin), Mia (lid). Album A1 en A2.
//   groep H: Xena (admin). Album B1.
//   A1: Owen-plek (exact, met adres als plaatsnaam), Mia-plek, Owen zonder
//       plek, Owen met alleen een breedte, en een publicatie van een foto die
//       gewist is.
//   A2: Owen-ver (een plek die alleen in A2 staat).
//   B1: Xena-plek.

import type { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";

export type T = ReturnType<typeof convexTest>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const A = api as any;
export { schema };

export const OWEN_SPOT = { latitude: 52.123456, longitude: 5.987654 };
export const MIA_SPOT = { latitude: 52.371234, longitude: 4.891234 };
export const FAR_SPOT = { latitude: 41.716789, longitude: 44.783456 };
export const XENA_SPOT = { latitude: 51.441234, longitude: 5.478912 };
export const OWEN_LABEL = "8 Dorpsstraat - Ergens - Nederland";

export async function insertPhoto(
  t: T,
  ownerId: Id<"users">,
  extra: { latitude?: number; longitude?: number; locationLabel?: string } = {},
): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"], { type: "image/jpeg" }));
    return await ctx.db.insert("photos", {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
      ...extra,
    });
  });
}

export async function publish(
  t: T,
  albumId: Id<"albums">,
  photoId: Id<"photos">,
  addedBy: Id<"users">,
): Promise<void> {
  await t.run(async (ctx) => {
    const album = await ctx.db.get(albumId);
    await ctx.db.insert("albumPhotos", {
      albumId,
      photoId,
      groupId: album!.groupId,
      addedAt: Date.now(),
      addedBy,
    });
  });
}

export async function world(t: T) {
  const owen = await registerUser(t, "user_owen", "owen@x.com", "Owen");
  const mia = await registerUser(t, "user_mia", "mia@x.com", "Mia");
  const xena = await registerUser(t, "user_xena", "xena@x.com", "Xena");

  const G = await withUser(t, "user_owen").mutation(api.groups.create, { name: "G" });
  await seedMember(t, { groupId: G, userId: mia });
  const A1 = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A1" });
  const A2 = await withUser(t, "user_owen").mutation(api.albums.create, { groupId: G, name: "A2" });

  const H = await withUser(t, "user_xena").mutation(api.groups.create, { name: "H" });
  const B1 = await withUser(t, "user_xena").mutation(api.albums.create, { groupId: H, name: "B1" });

  const owenSpot = await insertPhoto(t, owen, { ...OWEN_SPOT, locationLabel: OWEN_LABEL });
  const miaSpot = await insertPhoto(t, mia, { ...MIA_SPOT });
  const owenNoSpot = await insertPhoto(t, owen);
  const owenHalf = await insertPhoto(t, owen, { latitude: 50.5 });
  const owenFar = await insertPhoto(t, owen, { ...FAR_SPOT });
  const xenaSpot = await insertPhoto(t, xena, { ...XENA_SPOT });
  const gone = await insertPhoto(t, owen, { latitude: 10, longitude: 10 });

  for (const p of [owenSpot, owenNoSpot, owenHalf, gone]) await publish(t, A1, p, owen);
  await publish(t, A1, miaSpot, mia);
  await publish(t, A2, owenFar, owen);
  await publish(t, B1, xenaSpot, xena);
  // Publicatie blijft, foto-rij weg (zoals een half opgeruimde wis).
  await t.run((ctx) => ctx.db.delete(gone));

  return { owen, mia, xena, G, H, A1, A2, B1, owenSpot, miaSpot, owenNoSpot, owenHalf, owenFar, xenaSpot, gone };
}

/** De ConvexError-data van een weigering, of de melding van een gewone fout. */
export async function refusal(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return data !== undefined ? data : `Error: ${(e as Error).message}`;
  }
  return "geen weigering";
}

/** Afgerond op 2 decimalen (A-keuze 1). */
export const round2 = (x: number) => Math.round(x * 100) / 100;
