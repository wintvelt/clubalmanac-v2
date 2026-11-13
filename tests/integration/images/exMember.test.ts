import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { mintTokenForEmail, revokeSessionQuietly } from "../_helpers/clerkAuth";
import { makeConvexClient } from "../_helpers/convexClient";
import { getConvexSiteBase, requireEnv } from "../_helpers/convexSite";

// ---------------------------------------------------------------------------
// WP17a gate-stap 6 (fix-cyclus 1, S5): een ex-lid krijgt met een link die
// eerder werkte het beeld niet meer (invariant 2, besluit 1).
//
// Tegen de echte dev-deployment, met echte Clerk-tokens. Eigen wegwerp-groep:
// raakt "Gatetest" niet. Twee Clerk-testusers uit .env.integration:
//   - eigenaar = CLERK_TEST_USER_WEBMASTER_EMAIL: maakt groep, album, foto
//   - lid      = CLERK_TEST_USER_REGULAR_EMAIL: kijkt, vertrekt, kijkt opnieuw
// Beide hebben een users-rij op dev (WP4-setup).
//
// Niet in CI.
//   npm run test:integration -- tests/integration/images/exMember.test.ts
// ---------------------------------------------------------------------------

// Een paar bytes zijn genoeg: het beeldpad geeft terug wat er staat.
// extractMetadata slaat een bestand zonder EXIF stil over.
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x57, 0x50, 0x31, 0x37, 0x61, 0xff, 0xd9]);

describe("WP17a gate-stap 6 — ex-lid en een oude link", () => {
  let owner: { jwt: string; sessionId: string; client: ConvexHttpClient };
  let member: { jwt: string; sessionId: string; client: ConvexHttpClient };
  let site: string;
  let groupId: Id<"groups"> | null = null;
  let photoId: Id<"photos"> | null = null;

  async function login(email: string) {
    const { jwt, sessionId } = await mintTokenForEmail(email);
    const client = makeConvexClient();
    client.setAuth(jwt);
    return { jwt, sessionId, client };
  }

  beforeAll(async () => {
    site = getConvexSiteBase();
    owner = await login(requireEnv("CLERK_TEST_USER_WEBMASTER_EMAIL"));
    member = await login(requireEnv("CLERK_TEST_USER_REGULAR_EMAIL"));
  });

  afterAll(async () => {
    // Best effort: foto en groep weg (de eigenaar is oprichter van zijn groep).
    try {
      if (photoId) await owner.client.mutation(api.photos.remove, { photoId });
    } catch {
      // best effort
    }
    try {
      if (groupId) await owner.client.mutation(api.groups.remove, { groupId });
    } catch {
      // best effort
    }
    await revokeSessionQuietly(owner.sessionId);
    await revokeSessionQuietly(member.sessionId);
  });

  it(
    "lid: 200 met de bytes; na vertrek: 404 op dezelfde URL; zonder token: 401",
    async () => {
      const me = await member.client.query(api.users.current, {});
      expect(me, "het lid heeft een users-rij op dev").not.toBeNull();

      groupId = await owner.client.mutation(api.groups.create, {
        name: `WP17a gate 6 ${new Date().toISOString()}`,
      });
      // WP28 A-keuze 1: geen addMember meer. Lid worden gaat via een
      // uitnodiging van een admin (de eigenaar maakte de groep, dus is admin
      // en oprichter). Let op: invites.create plant een uitnodigingsmail naar
      // het testadres op dev.
      const { inviteId } = await owner.client.mutation(api.invites.create, { name: "Genodigde",
        email: requireEnv("CLERK_TEST_USER_REGULAR_EMAIL"),
        groupId,
      });
      await member.client.mutation(api.invites.accept, { inviteId });
      const albumId = await owner.client.mutation(api.albums.create, { groupId, name: "Gate 6" });

      const up = await fetch(`${site}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.jwt}`,
          "X-Upload-Id": `wp17a-gate6-${Date.now()}`,
          "Content-Type": "image/jpeg",
        },
        body: BYTES,
      });
      expect(up.status).toBe(200);
      photoId = ((await up.json()) as { photoId: Id<"photos"> }).photoId;
      await owner.client.mutation(api.albums.addPhoto, { albumId, photoId });

      const url = `${site}/beeld/foto/${photoId}?formaat=klein`;
      const auth = { headers: { Authorization: `Bearer ${member.jwt}` } };

      const before = await fetch(url, auth);
      expect(before.status, "als lid").toBe(200);
      expect(new Uint8Array(await before.arrayBuffer())).toEqual(BYTES);

      await member.client.mutation(api.groups.removeMember, { groupId, userId: me!._id });

      const after = await fetch(url, auth);
      expect(after.status, "als ex-lid, met dezelfde URL en een geldig token").toBe(404);
      expect(new Uint8Array(await after.arrayBuffer())).not.toEqual(BYTES);

      const anon = await fetch(url);
      expect(anon.status, "zonder token").toBe(401);
      await anon.arrayBuffer();
    },
    60_000,
  );
});
