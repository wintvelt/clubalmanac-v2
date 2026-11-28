import { describe, expect, it, vi } from "vitest";

// WP47: de module zegt of de geïnstalleerde build uit TestFlight komt.
// `testFlightBuild()` geeft `true` alleen bij een echt ja van de native kant,
// `false` bij een echt nee, en anders `null` (weet niet): geen module (web),
// geen functie (Android, een build van vóór WP47), een fout of een vreemd
// antwoord. Hij wijst nooit af: Info mag er niet op stuklopen (invariant 1, 4,
// 8, 10).
// Spec: docs/work-packages/WP47-versielabel.md §Spec-criticus aanvullingen.

type TestFlightBuild = () => Promise<boolean | null>;

async function load(native: Record<string, unknown> | null): Promise<TestFlightBuild> {
  vi.resetModules();
  vi.doMock("expo", () => ({ requireOptionalNativeModule: () => native }));
  const mod = (await import("../modules/clubalmanac-video")) as Record<string, unknown>;
  expect(typeof mod.testFlightBuild, "testFlightBuild ontbreekt in modules/clubalmanac-video").toBe("function");
  return mod.testFlightBuild as TestFlightBuild;
}

describe("testFlightBuild (WP47)", () => {
  it("zonder module (webapp): weet niet", async () => {
    const testFlightBuild = await load(null);
    await expect(testFlightBuild()).resolves.toBeNull();
  });

  it("module zonder de functie (Android, een build van vóór WP47): weet niet", async () => {
    const testFlightBuild = await load({ buildNumber: () => "98" });
    await expect(testFlightBuild()).resolves.toBeNull();
  });

  it("native ja: TestFlight", async () => {
    const testFlight = vi.fn(async () => true);
    const testFlightBuild = await load({ testFlight });
    await expect(testFlightBuild()).resolves.toBe(true);
    expect(testFlight).toHaveBeenCalled();
  });

  it("native nee: geen TestFlight", async () => {
    const testFlightBuild = await load({ testFlight: async () => false });
    await expect(testFlightBuild()).resolves.toBe(false);
  });

  it("een antwoord dat geen boolean is: weet niet (invariant 10)", async () => {
    for (const answer of ["sandbox", "true", 1, 0, null, undefined, {}]) {
      const testFlightBuild = await load({ testFlight: async () => answer });
      await expect(testFlightBuild(), String(answer)).resolves.toBeNull();
    }
  });

  it("een native fout: weet niet, geen afwijzing (invariant 4)", async () => {
    const rejects = await load({ testFlight: async () => Promise.reject(new Error("StoreKit")) });
    await expect(rejects()).resolves.toBeNull();
    const throws = await load({
      testFlight: () => {
        throw new Error("StoreKit");
      },
    });
    await expect(throws()).resolves.toBeNull();
  });
});
