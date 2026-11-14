"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { makeMailCover } from "./lib/mailCover";

// WP19c: de Node-stap van de uitnodigingsmail. `internal.invites.sendInviteEmail`
// blijft het entrypoint en roept deze action alleen aan als de groep een cover
// heeft die in de mail mag (`images.inviteMailCover`). Hier draait sharp
// (WP25, `externalPackages`): rechtop zetten, metadata eraf, grootte bewaken.
//
// Alles wat misgaat geeft `null`: de mail gaat dan zonder foto (invariant 5,
// A-invariant 7). Er komt geen exception uit.

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
