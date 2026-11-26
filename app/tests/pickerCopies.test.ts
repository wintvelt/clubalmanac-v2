import { describe, expect, it, vi } from "vitest";

// WP42 mini-fix na audit fix-ronde: de pure helpers van de kopieën van de
// kiezer. De profielfoto haalt alleen de eigen kopieën weg (wat er na de
// kiezer bij kwam), niet de hele map.

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));

const { isPickerCopy, newPickerCopies, plainPath } = await import("../src/data/pickerCopies");

const dir = { uri: "file:///private/var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/" };

describe("plainPath", () => {
  it("zonder file:// en zonder /private", () => {
    expect(plainPath("file:///private/var/a.jpg")).toBe("/var/a.jpg");
    expect(plainPath("file:///var/a.jpg")).toBe("/var/a.jpg");
  });
  it("decodeert spaties", () => {
    expect(plainPath("file:///var/een%20foto.jpg")).toBe("/var/een foto.jpg");
  });
});

describe("isPickerCopy", () => {
  it("/var tegen /private/var telt als in de map", () => {
    expect(isPickerCopy("file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/a.jpg", dir)).toBe(true);
  });
  it("een map zonder slot-streep", () => {
    expect(isPickerCopy("file:///data/cache/ImagePicker/a.jpg", { uri: "file:///data/cache/ImagePicker" })).toBe(true);
  });
  it("een uri buiten de map niet", () => {
    expect(isPickerCopy("file:///var/mobile/Containers/Data/Application/X/Documents/originelen/a.mov", dir)).toBe(false);
    expect(isPickerCopy("file:///data/cache/ImagePickerAnders/a.jpg", { uri: "file:///data/cache/ImagePicker" })).toBe(false);
  });
});

describe("newPickerCopies", () => {
  it("alleen wat erbij kwam, ook met /private ervoor", () => {
    const before = ["file:///private/var/c/ImagePicker/oud1.jpg", "file:///var/c/ImagePicker/oud2.jpg"];
    const after = [
      "file:///var/c/ImagePicker/oud1.jpg",
      "file:///var/c/ImagePicker/oud2.jpg",
      "file:///var/c/ImagePicker/nieuw.jpg",
      "file:///var/c/ImagePicker/nieuw-origineel.jpg",
    ];
    expect(newPickerCopies(before, after)).toEqual([
      "file:///var/c/ImagePicker/nieuw.jpg",
      "file:///var/c/ImagePicker/nieuw-origineel.jpg",
    ]);
  });
  it("niets nieuw: leeg", () => {
    expect(newPickerCopies(["file:///a"], ["file:///a"])).toEqual([]);
  });
});
