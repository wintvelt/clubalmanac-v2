// Email-normalisatie invariant: alle email-strings (in users.email,
// invites.email, lookup-keys, comparisons) worden lowercased + getrimd
// opgeslagen en vergeleken via deze helper. Single source of truth zodat
// users.ts, invites.ts en lib/auth.ts dezelfde implementation delen.
// Zie docs/migratie-plan-convex.md "Email-normalisatie invariant".
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
