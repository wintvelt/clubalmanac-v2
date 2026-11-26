import { describe, expect, it, vi } from "vitest";

// WP42 draftpunt 5 en acceptance: op Android (42a) zit de eigen module
// `clubalmanac-video` niet in de build. Het laden mag dan niet falen, en wat
// de app zonder module aanroept, faalt stil in plaats van te gooien. Een
// bewaker: nu groen, rood als een wijziging de module verplicht maakt.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus 42a.

vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));

const video = await import("../modules/clubalmanac-video");

describe("WP42: de app zonder video-module (Android)", () => {
  it("laadt, en zegt dat er geen module en geen uploader is", () => {
    expect(video.videoModuleAvailable).toBe(false);
    expect(video.originalUploaderAvailable).toBe(false);
  });

  it("de kiezer-vraag weet het niet: null", async () => {
    await expect(video.pickerOnScreen()).resolves.toBeNull();
  });

  it("stoppen en wissen lukken stil", async () => {
    await expect(video.cancelCompress("x")).resolves.toBeUndefined();
    await expect(video.removeFile("file:///tmp/x.mp4")).resolves.toBeUndefined();
  });

  it("luisteren naar de uploader geeft een afmelder die niets doet", () => {
    const stop = video.listenUploader({ partDone: () => {}, network: () => {} });
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });

  it("de proefstand van de uploader: deze build kan het niet", async () => {
    await expect(video.uploaderExitAfterBackgroundSend()).resolves.toBeNull();
  });
});
