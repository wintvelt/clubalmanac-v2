import type { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";

// WP26 — gedeelde opzet voor de gate-tests op convex/_test.ts.
//
// Contract (spec §Antwoorden vraag 1):
//   - deployment-env `INTEGRATION_TEST_ENABLED` ("true") én
//     `INTEGRATION_TEST_SECRET` (het geheim);
//   - elke publieke functie in _test.ts neemt een optioneel argument
//     `testSecret` (string) dat exact gelijk moet zijn aan het geheim.
//
// Het geheim hier is een nep-waarde, alleen voor de unit-suite. Het echte
// geheim staat alleen op de dev-deployment en in `.env.integration`.
//
// Functie-referenties via makeFunctionReference (niet de gegenereerde `api`),
// zodat de tests typechecken los van de signatuur die B kiest.

export type T = ReturnType<typeof convexTest>;

export const FAKE_SECRET = "wp26-nep-geheim-alleen-voor-unit-tests-0123456789abcdef";
export const WRONG_SECRET = "wp26-ander-nep-geheim-oud-of-geroteerd-fedcba9876543210";

export const ENV_FLAG = "INTEGRATION_TEST_ENABLED";
export const ENV_SECRET = "INTEGRATION_TEST_SECRET";

export type DeploymentEnv = { flag?: string; secret?: string };

/** Zet de env-vars van de "deployment" (convex-test leest process.env). */
export function setDeploymentEnv(env: DeploymentEnv): void {
  if (env.flag === undefined) delete process.env[ENV_FLAG];
  else process.env[ENV_FLAG] = env.flag;
  if (env.secret === undefined) delete process.env[ENV_SECRET];
  else process.env[ENV_SECRET] = env.secret;
}

export const OPEN_ENV: DeploymentEnv = { flag: "true", secret: FAKE_SECRET };

export type Kind = "query" | "mutation" | "action";

export type Recipe = {
  /** Naam van de export in convex/_test.ts. */
  name: string;
  kind: Kind;
  /** Geldige argumenten (zonder testSecret); mag fixtures aanmaken via t.run. */
  args: (t: T) => Promise<Record<string, unknown>>;
};

const USER_FIXTURE = {
  photoCount: 0,
  photoLimit: 1000,
};

async function seedUser(t: T, tag: string): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject: `user_wp26_${tag}`,
      email: `wp26_${tag}@x.test`,
      name: `WP26 ${tag}`,
      createdAt: Date.now(),
      ...USER_FIXTURE,
    }),
  );
}

async function storeBlob(t: T): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["wp26-bytes"])));
}

async function seedGroupAndInvite(t: T) {
  const inviterUserId = await seedUser(t, "inviter");
  return await t.run(async (ctx) => {
    const groupId = await ctx.db.insert("groups", {
      name: "WP26 groep",
      createdBy: inviterUserId,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: "wp26_invitee@x.test",
      invitedBy: inviterUserId,
      groupId,
      role: "member",
      token: "wp26-token",
      status: "pending",
      expiresAt: Date.now() + 86_400_000,
      createdAt: Date.now(),
    });
    return { inviteId, groupId, inviterUserId };
  });
}

/**
 * Eén recept per publieke functie in convex/_test.ts. inventory.test.ts
 * eist dat deze lijst precies de publieke exports dekt (invariant 4): een
 * nieuwe publieke functie zonder recept maakt die test rood.
 */
export const RECIPES: Recipe[] = [
  {
    name: "storageUpload",
    kind: "action",
    args: async () => ({
      bytes: new TextEncoder().encode("wp26-upload").buffer,
      contentType: "image/jpeg",
    }),
  },
  {
    name: "storageDownloadUrl",
    kind: "query",
    args: async (t) => ({ storageId: await storeBlob(t) }),
  },
  {
    name: "storageDelete",
    kind: "mutation",
    args: async (t) => ({ storageId: await storeBlob(t) }),
  },
  {
    name: "getUserBySubject",
    kind: "query",
    args: async (t) => {
      await seedUser(t, "lookup");
      return { subject: "user_wp26_lookup" };
    },
  },
  {
    name: "listInvitesByEmail",
    kind: "query",
    args: async (t) => {
      await seedGroupAndInvite(t);
      return { email: "wp26_invitee@x.test" };
    },
  },
  {
    name: "listMembershipsByUserId",
    kind: "query",
    args: async (t) => ({ userId: await seedUser(t, "member") }),
  },
  {
    name: "seedOnboardingFixture",
    kind: "mutation",
    args: async () => ({ email: "wp26_seed@x.test" }),
  },
  {
    name: "cleanupUserBySubject",
    kind: "mutation",
    args: async (t) => {
      await seedUser(t, "victim");
      return { subject: "user_wp26_victim" };
    },
  },
  {
    name: "cleanupOnboardingSeed",
    kind: "mutation",
    args: async (t) => seedGroupAndInvite(t),
  },
];

/**
 * Http-routes die alleen voor tests bestaan (A-keuze 2). whoami.test.ts
 * beproeft de gate; inventory.test.ts eist dat deze lijst compleet is.
 */
export const HTTP_TEST_ROUTES = ["GET /_test/whoami"] as const;

export const SECRET_HEADER = "X-Test-Secret";

/** Roept een _test-functie aan; `secret` undefined = geen testSecret-veld. */
export async function call(
  t: T,
  recipe: Recipe,
  args: Record<string, unknown>,
  secret: string | undefined,
): Promise<unknown> {
  const fullArgs = secret === undefined ? { ...args } : { ...args, testSecret: secret };
  const path = `_test:${recipe.name}`;
  switch (recipe.kind) {
    case "query":
      return await t.query(
        makeFunctionReference<"query", Record<string, unknown>, unknown>(path),
        fullArgs,
      );
    case "mutation":
      return await t.mutation(
        makeFunctionReference<"mutation", Record<string, unknown>, unknown>(path),
        fullArgs,
      );
    case "action":
      return await t.action(
        makeFunctionReference<"action", Record<string, unknown>, unknown>(path),
        fullArgs,
      );
  }
}

export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; message: string; data: unknown };

export async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    const e = err as { message?: unknown; data?: unknown };
    return {
      ok: false,
      message: typeof e?.message === "string" ? e.message : String(err),
      data: e?.data ?? null,
    };
  }
}

/** Een weigering door de gate, niet door Convex' argumentvalidatie. */
export const VALIDATION_ERROR = /Validator error|ArgumentValidationError|Unexpected field|Missing required field/;

/** Momentopname van de tabellen en storage die _test-functies raken. */
export async function snapshot(t: T): Promise<string> {
  return await t.run(async (ctx) => {
    const tables = ["users", "groups", "invites", "memberships", "albumLastSeen"] as const;
    const out: Record<string, unknown> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      out[table] = rows.map((r) => r._id).sort();
    }
    const files = await ctx.db.system.query("_storage").collect();
    out._storage = files.map((f) => f._id).sort();
    return JSON.stringify(out);
  });
}
