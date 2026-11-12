import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { A, OWEN_SPOT, refusal, schema, world } from "./_world";

// WP17d A-invariant 2: `photos.getLocation({ photoId })`, de exacte plek van
// een eigen foto (voor "Locatie wijzigen", ook vanuit Mijn foto's). Alleen de
// eigenaar; geen orakel voor de anderen.

describe("photos.getLocation (A-invariant 2)", () => {
  it("eigenaar: de exacte plek, precies { latitude, longitude }", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(await withUser(t, "user_owen").query(A.photos.getLocation, { photoId: w.owenSpot })).toEqual(
      OWEN_SPOT,
    );
  });

  it("eigenaar, foto zonder plek of met maar één coördinaat: null", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    expect(await owen.query(A.photos.getLocation, { photoId: w.owenNoSpot })).toBeNull();
    expect(await owen.query(A.photos.getLocation, { photoId: w.owenHalf })).toBeNull();
  });

  it("een lid met toegang, een buitenstaander, een gewiste foto: dezelfde NOT_PHOTO_OWNER", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const member = await refusal(withUser(t, "user_mia").query(A.photos.getLocation, { photoId: w.owenSpot }));
    const outsider = await refusal(
      withUser(t, "user_xena").query(A.photos.getLocation, { photoId: w.owenSpot }),
    );
    const gone = await refusal(withUser(t, "user_owen").query(A.photos.getLocation, { photoId: w.gone }));
    expect(member).toEqual({ code: "NOT_PHOTO_OWNER" });
    expect(outsider).toEqual(member);
    expect(gone).toEqual(member);
  });

  it("uitgelogd: weigering", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await expect(t.query(A.photos.getLocation, { photoId: w.owenSpot })).rejects.toThrow();
  });
});
