import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import * as constants from "../../convex/lib/constants";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { JPEG, PNG, ftyp, leftovers, upload } from "./_upload";

// WP18 — de poort van POST /upload.
//
// A-invariant 12 (kernvondst 2): een upload-id waarvan de foto al gemaakt is,
//   geeft die foto terug, ook als de user nu op zijn limiet zit. Anders meldt
//   de app "limiet" voor een foto die er al is, en staat hij niet in het album.
// A-invariant 13 (kernvondst 3): breekt het lezen van de body af, dan blijft er
//   geen reservering `in_progress` staan; dezelfde id kan meteen opnieuw.
// A-invariant 14 (invariant 6, kernvondst 4): alleen JPEG, PNG en HEIC, herkend
//   aan de bytes en niet aan `Content-Type` (anders 415); niet boven 15 MiB
//   (413). Geen reservering, geen beeld, geen foto, telling gelijk.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Spec-criticus aanvullingen.

const MAX_UPLOAD_BYTES = (constants as Record<string, unknown>).MAX_UPLOAD_BYTES as number;

const HEIC = new Uint8Array(readFileSync(new URL("../fixtures/wp25/g6.heic", import.meta.url)));

const NOTHING = { photos: 0, reservations: 0, storage: 0, albumPhotos: 0, photoCount: 0 };

async function owen(t: ReturnType<typeof convexTest>) {
  return await registerUser(t, "user_owen", "owen@x.com", "Owen");
}

describe("A-invariant 12: een herhaling geeft de bestaande foto, ook op de limiet", () => {
  it("de laatste foto onder de limiet, antwoord verloren, herhaling met dezelfde id: dezelfde foto", async () => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    await t.run((ctx) => ctx.db.patch(id, { photoLimit: 1 }));

    const first = await upload(t, "user_owen", { uploadId: "laatste" });
    expect(first.status).toBe(200);
    const { photoId } = (await first.json()) as { photoId: string };

    const again = await upload(t, "user_owen", { uploadId: "laatste" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { photoId: string }).photoId).toBe(photoId);

    const left = await leftovers(t, id);
    expect(left.photos).toBe(1);
    expect(left.photoCount).toBe(1);
  });

  it("ook als de user daarna over zijn limiet zit (limiet verlaagd)", async () => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    const first = await upload(t, "user_owen", { uploadId: "u-1" });
    const { photoId } = (await first.json()) as { photoId: string };
    await t.run((ctx) => ctx.db.patch(id, { photoLimit: 0 }));

    const again = await upload(t, "user_owen", { uploadId: "u-1" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { photoId: string }).photoId).toBe(photoId);
  });

  it("controle: een nieuwe id op de limiet blijft 403 en laat niets achter", async () => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    await t.run((ctx) => ctx.db.patch(id, { photoLimit: 1 }));
    await upload(t, "user_owen", { uploadId: "u-1" });
    const before = await leftovers(t, id);

    const res = await upload(t, "user_owen", { uploadId: "u-2" });
    expect(res.status).toBe(403);
    expect(await leftovers(t, id)).toEqual(before);
  });
});

describe("A-invariant 13: een afgebroken body laat geen reservering achter", () => {
  function brokenBody(): ReadableStream<Uint8Array> {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(JPEG);
        } else {
          controller.error(new Error("verbinding weg"));
        }
      },
    });
  }

  it("de verbinding breekt tijdens het versturen; dezelfde id lukt daarna meteen", async () => {
    const t = convexTest(schema, modules);
    const id = await owen(t);

    let status: number | "throw";
    try {
      const res = await withUser(t, "user_owen").fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", "X-Upload-Id": "vliegtuig" },
        body: brokenBody(),
        duplex: "half",
      } as RequestInit);
      status = res.status;
    } catch {
      status = "throw";
    }
    expect(status).not.toBe(200);

    // Niets achter: geen reservering, geen foto, geen beeld, telling gelijk.
    expect(await leftovers(t, id)).toEqual(NOTHING);

    const retry = await upload(t, "user_owen", { uploadId: "vliegtuig" });
    expect(retry.status).toBe(200);
    expect((await leftovers(t, id)).photos).toBe(1);
  });
});

describe("A-invariant 14: alleen beelden, herkend aan de bytes", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["HEIC (iPhone)", HEIC, "image/heic"],
    ["JPEG met een vreemde Content-Type", JPEG, "application/octet-stream"],
  ])("%s: aangenomen", async (_label, body, contentType) => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "goed", body, contentType });
    expect(res.status).toBe(200);
    expect((await leftovers(t, id)).photos).toBe(1);
  });

  it.each([
    ["MP4-video als image/jpeg", ftyp("mp42"), "image/jpeg"],
    ["MOV-video als image/heic", ftyp("qt  "), "image/heic"],
    ["tekst als image/jpeg", new TextEncoder().encode("hallo, dit is geen foto"), "image/jpeg"],
    ["PDF als image/png", new TextEncoder().encode("%PDF-1.4\n%âãÏÓ\n"), "image/png"],
    ["GIF", new TextEncoder().encode("GIF89a\x01\x00\x01\x00"), "image/gif"],
    ["leeg", new Uint8Array(0), "image/jpeg"],
  ])("%s: 415, niets achter", async (_label, body, contentType) => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "fout", body, contentType });
    expect(res.status).toBe(415);
    expect(await leftovers(t, id)).toEqual(NOTHING);
  });

  it("na een 415 lukt dezelfde id met een goed bestand", async () => {
    const t = convexTest(schema, modules);
    const id = await owen(t);
    await upload(t, "user_owen", { uploadId: "x", body: ftyp("mp42") });
    const res = await upload(t, "user_owen", { uploadId: "x", body: JPEG });
    expect(res.status).toBe(200);
    expect((await leftovers(t, id)).photos).toBe(1);
  });
});

describe("A-invariant 14 en A-keuze 4: grens 15 MiB", () => {
  function jpegOfSize(n: number): Uint8Array {
    const b = new Uint8Array(n);
    b.set(JPEG);
    return b;
  }

  it("de grens staat in convex/lib/constants.ts en is 15 MiB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });

  it("één byte erboven: 413, niets achter", async () => {
    expect(typeof MAX_UPLOAD_BYTES).toBe("number");
    const t = convexTest(schema, modules);
    const id = await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "groot", body: jpegOfSize(MAX_UPLOAD_BYTES + 1) });
    expect(res.status).toBe(413);
    expect(await leftovers(t, id)).toEqual(NOTHING);
  });

  it("precies op de grens: aangenomen", async () => {
    expect(typeof MAX_UPLOAD_BYTES).toBe("number");
    const t = convexTest(schema, modules);
    const id = await owen(t);
    const res = await upload(t, "user_owen", { uploadId: "net", body: jpegOfSize(MAX_UPLOAD_BYTES) });
    expect(res.status).toBe(200);
    expect((await leftovers(t, id)).photos).toBe(1);
  });

  it("na een 413 lukt dezelfde id met een kleiner bestand", async () => {
    expect(typeof MAX_UPLOAD_BYTES).toBe("number");
    const t = convexTest(schema, modules);
    const id = await owen(t);
    await upload(t, "user_owen", { uploadId: "y", body: jpegOfSize(MAX_UPLOAD_BYTES + 1) });
    const res = await upload(t, "user_owen", { uploadId: "y", body: JPEG });
    expect(res.status).toBe(200);
    expect((await leftovers(t, id)).photos).toBe(1);
  });
});
