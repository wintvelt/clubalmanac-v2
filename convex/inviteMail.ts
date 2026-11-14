"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { INVITE_PHOTO_CONTENT_ID, INVITE_PHOTO_FILENAME } from "./lib/emailTemplates";
import { makeMailCover } from "./lib/mailCover";
import { INVITES_SENDER } from "./lib/mailjet";
import { sendMailjetSmtp } from "./lib/mailjetSmtp";

// WP19c: de Node-stap van de uitnodigingsmail. `internal.invites.sendInviteEmail`
// blijft het entrypoint en roept deze action alleen aan als de groep een cover
// heeft die in de mail mag (`images.inviteMailCover`). Hier draait sharp
// (WP25, `externalPackages`): rechtop zetten, metadata eraf, grootte bewaken.
//
// `coverAttachment`: alles wat misgaat geeft `null`; de mail gaat dan zonder
// foto (invariant 5, A-invariant 7). Er komt geen exception uit.
//
// `sendWithPhoto` (besluit 5): de uitnodiging met foto via Mailjet's SMTP-ingang
// (`lib/mailjetSmtp.ts`). Gooit bij elke fout; `sendInviteEmail` valt dan terug
// op de Send API zonder foto (A-keuze 7).

export const coverAttachment = internalAction({
  args: { storageId: v.id("_storage"), exifOrientation: v.optional(v.number()) },
  returns: v.union(v.object({ base64Content: v.string(), width: v.number() }), v.null()),
  handler: async (ctx, { storageId, exifOrientation }) => {
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) return null;
      // Geen `Blob.slice` in Convex (convex-runtimes.md): de hele buffer.
      const cover = await makeMailCover(new Uint8Array(await blob.arrayBuffer()), exifOrientation);
      if (!cover) {
        console.warn("[inviteMail] groepsfoto te groot voor de mail, de mail gaat zonder foto");
        return null;
      }
      return { base64Content: Buffer.from(cover.bytes).toString("base64"), width: cover.width };
    } catch (e) {
      console.error(
        `[inviteMail] groepsfoto niet te verwerken, de mail gaat zonder foto: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  },
});

export const sendWithPhoto = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    htmlPart: v.string(),
    textPart: v.string(),
    photoBase64: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, { to, subject, htmlPart, textPart, photoBase64 }) => {
    await sendMailjetSmtp({
      from: { email: INVITES_SENDER },
      to: [{ email: to }],
      subject,
      htmlPart,
      textPart,
      inlineImages: [
        {
          contentId: INVITE_PHOTO_CONTENT_ID,
          filename: INVITE_PHOTO_FILENAME,
          contentType: "image/jpeg",
          content: new Uint8Array(Buffer.from(photoBase64, "base64")),
        },
      ],
    });
    return null;
  },
});
