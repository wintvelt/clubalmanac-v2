import { v } from "convex/values";
import { query } from "./_generated/server";

// Smoke query: bewijst dat de Convex → TypeScript type-pipeline werkt.
// Verwijderbaar zodra echte queries in fase 2 bestaan.
export const ping = query({
  args: {},
  returns: v.object({
    ok: v.literal(true),
    message: v.string(),
  }),
  handler: async () => ({ ok: true as const, message: "pong" }),
});
