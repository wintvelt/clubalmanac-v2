import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { myGroupRole } from "../src/lib/groups";

// Feedback Wouter, webapp dev (2026-11-25, tweede ronde), punt 2: in Mijn
// groepen staat bij een groep waarvan je de oprichter bent "Oprichter" in
// plaats van "Admin", met de gele sleutel (`founderKey`) erachter. Anders
// zoals nu ("Admin" of "Lid"). App en webapp (één scherm). Zolang de eigen
// user nog laadt: zoals nu, zonder sleutel.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Feedback webapp dev, tweede ronde (A).

describe("myGroupRole: de rol op de kaart in Mijn groepen", () => {
  it("de oprichter: 'Oprichter', met sleutel", () => {
    expect(myGroupRole({ role: "admin", createdBy: "u1", me: "u1" })).toEqual({ label: "Oprichter", founderKey: true });
  });

  it("een admin die geen oprichter is: 'Admin', zonder sleutel", () => {
    expect(myGroupRole({ role: "admin", createdBy: "u2", me: "u1" })).toEqual({ label: "Admin", founderKey: false });
  });

  it("een lid: 'Lid', zonder sleutel", () => {
    expect(myGroupRole({ role: "member", createdBy: "u2", me: "u1" })).toEqual({ label: "Lid", founderKey: false });
  });

  it("de eigen user nog niet bekend: zoals nu, zonder sleutel", () => {
    expect(myGroupRole({ role: "admin", createdBy: "u1", me: undefined })).toEqual({ label: "Admin", founderKey: false });
    expect(myGroupRole({ role: "admin", createdBy: "u1", me: null })).toEqual({ label: "Admin", founderKey: false });
  });
});

describe("Mijn groepen gebruikt myGroupRole en toont de gele sleutel", () => {
  const file = fileURLToPath(new URL("../src/screens/MyGroupsScreen.tsx", import.meta.url));
  const src = existsSync(file) ? readFileSync(file, "utf8") : "";

  it("de rolregel komt uit myGroupRole, niet meer uit roleLabel", () => {
    expect(src.length, "sanity: MyGroupsScreen.tsx").toBeGreaterThan(0);
    expect(src).toContain("myGroupRole(");
    expect(src).not.toMatch(/\broleLabel\(/);
  });

  it("de sleutel in de kleur founderKey (direct, of via een component uit src/components)", () => {
    const viaComponent = /from "\.\.\/components\/Founder\w*"/.test(src);
    expect(src.includes("founderKey") || viaComponent).toBe(true);
  });
});
