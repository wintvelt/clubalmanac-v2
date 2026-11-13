# WP6 Clerk — empirische gates runbook

Drie mens-gates uit [`WP6-clerk-session-webhook.md`](../work-packages/WP6-clerk-session-webhook.md) §Empirische gate. Bedoeld om vóór cutover (dev nu, prod later) atomic-onboarding-flow + idempotency end-to-end te verifiëren via Clerk's hosted signup-UI — eigen frontend is niet vereist.

Cross-ref: env-vars + Clerk webhook-config in [`external-services.md` §Auth Clerk](../conventions/external-services.md).

## Pre-flight checklist

### A. Clerk dashboard

- [ ] **Webhook endpoint configureren**: dashboard → Webhooks → Add Endpoint. URL: `https://glorious-pheasant-759.eu-west-1.convex.site/clerk-webhook` (region-suffix verplicht). Subscribe op event-type **minimaal `session.created`** (andere events optioneel — handler doet 200-no-op). Save.
- [ ] **Signing secret kopiëren** uit dashboard webhook-detail. Format: `whsec_<base64>`. Bewaar 'm — straks naar Convex env.
- [ ] **Verification settings controleren**: dashboard → Configure → Email, Phone, Username → Email Address. "Verification required before session" = **AAN** (default). Geen wijziging nodig, even confirmeren.

### B. Convex dev-deployment env-var

```bash
npx convex env set CLERK_WEBHOOK_SECRET <whsec_xxx-uit-clerk-dashboard>
```

Verificatie: `npx convex env list` toont nu o.a. `CLERK_WEBHOOK_SECRET` naast de WP5 Mailjet-vars.

### C. Convex deploy

```bash
npx convex dev --once
```

Zorg dat laatste WP6-commits (`114766a` impl + `36ed17e` closeout) op deployment staan. Verifieer:

```bash
curl -i -X POST "https://glorious-pheasant-759.eu-west-1.convex.site/clerk-webhook" -d '{}'
```

Verwacht: HTTP 401 (geen Svix-headers). 503 = `CLERK_WEBHOOK_SECRET` is unset. 404 = deploy nog niet doorgekomen.

### D. Test-data in Convex dev DB

Via Convex dashboard → Functions of via `npx convex run`:

- [ ] **Eén inviter-user** met group: gebruik het test-account van WP5 gates (`wintvelt@me.com`) — staat al in `users`-tabel + heeft een test-group + membership. Geen extra werk.
- [ ] **Voor Gate 1**: één pending invite voor een vers, werkend test-email (bv. `wintvelt+wp6-gate1@gmail.com` als je Gmail hebt; iCloud me.com doet géén `+aliases`). Via dashboard Functions → `invites.create` met identity = inviter-subject, args `{ email: "wintvelt+wp6-gate1@gmail.com", groupId: <test-group-id>, message: "WP6 Gate 1" }`.

## Gate 1 — happy-path signup-completion

**Doel**: bewijzen dat een Clerk-signup voor een email met pending invite atomair leidt tot users-row + invite-accepted + membership in Convex.

### Stappen

1. Ga naar Clerk dev-instance signup-pagina: `https://picked-quail-97.accounts.dev/sign-up`
2. Signup met email `wintvelt+wp6-gate1@gmail.com` (zelfde als pending invite uit pre-flight D) + nieuw password
3. Verificatie-mail van Clerk landt in je inbox — klik de verify-link
4. Clerk redirect naar default after-signup-pagina (Clerk hosted — geen eigen frontend nodig)
5. Convex dashboard → Logs (linker sidebar) → filter laatste minuut. Verwacht:
   - Eén `/clerk-webhook` http-action hit, status 200
   - Eén `internal.users.registerFromSession` mutation, success

### Verificatie via Convex dashboard → Data

- **`users`-tabel**: nieuwe row met
  - `subject` = `user_xxx` (Clerk subject, zichtbaar in Clerk dashboard user-detail)
  - `email` = `wintvelt+wp6-gate1@gmail.com` (lowercase normalized)
  - `name` = whatever je in Clerk-signup invulde, of undefined
  - `photoCount` = 0, `photoLimit` = 1000
- **`invites`-tabel**: invite voor `wintvelt+wp6-gate1@gmail.com` heeft
  - `status` = `"accepted"`
  - `respondedAt` = timestamp ~nu
- **`memberships`-tabel**: nieuwe row met
  - `userId` = nieuwe users-row-id
  - `groupId` = je test-group-id
  - `role` = `"member"` (of `"admin"` als invite-role-arg dat was)
  - `joinedAt` = ~nu

✅ Pass-criterium: alle drie de records aanwezig, één-mutation-tx zoals verwacht.

## Gate 2 — idempotency re-login

**Doel**: pin't dat re-login (subsequent `session.created` event) een no-op is — geen dubbele users-row, geen dubbele membership.

### Stappen

1. Op Clerk hosted UI: log uit met de Gate 1 test-user
2. Log opnieuw in met dezelfde credentials → Clerk vuurt nieuwe `session.created`
3. Convex dashboard → Logs → kijk naar nieuwe `/clerk-webhook` hit

### Verificatie via Convex Data

- **`users`-tabel**: still één row voor `wintvelt+wp6-gate1@gmail.com` (geen duplicate)
- **`memberships`-tabel**: still één row voor `(user, group)` (geen duplicate-insert)
- **`invites`-tabel**: invite blijft `accepted` (geen status-flip)

✅ Pass-criterium: webhook log toont 200 success, geen DB-mutatie zichtbaar in row-counts. Idempotency-subject-check werkt.

## Gate 3 — geen account zonder uitnodiging (WP19b)

**Doel**: bewijst dat een Clerk-sessie zonder accepteerbare uitnodiging **geen** users-row maakt (WP19b A-invariant 1). Was tot WP19b de "zero-invite fallback" (rij zonder lidmaatschap); dat is omgedraaid. Ook de webmaster krijgt geen rij zonder uitnodiging.

### Stappen

1. Log in de app in met een vers adres dat **geen** open uitnodiging heeft (bv. `wintvelt+wp6-gate3@gmail.com`): e-mail, code, klaar. Clerk maakt de Clerk-user (sign-in-or-up).
2. De webhook vuurt `session.created`.

### Verificatie

- **Convex logs**: `/clerk-webhook` geeft 200 (geen herhaling door Svix).
- **`users`-tabel**: géén row voor dit adres; `memberships` en `invites` ongewijzigd.
- **App**: "Je hebt eerst een uitnodiging nodig", met Uitloggen.
- **Daarna**: een admin nodigt dit adres uit; uitloggen en opnieuw inloggen maakt de rij en het lidmaatschap (A-invariant 2).

✅ Pass-criterium: 200, geen users-row, het scherm "eerst een uitnodiging"; na uitnodigen en opnieuw inloggen wel een rij.

## Negatieve curl-test (optioneel)

Net als WP5 — bewijs dat spoof-attempts ge-401'd worden:

```bash
curl -i -X POST "https://glorious-pheasant-759.eu-west-1.convex.site/clerk-webhook" \
  -H "Content-Type: application/json" \
  -d '{"type":"session.created","data":{"user":{"id":"user_fake"}}}'
```

Verwacht: HTTP 401 (geen valid Svix-headers). Géén state-mutatie in `users` of `memberships`.

## Bij fouten

- **Mail komt niet** (Gate 1 verify-step): check Clerk dashboard → Users → Email status. Clerk's signup-mail kan in spam landen — check spam-folder.
- **Webhook 401 bij Clerk's eigen test-event** (dashboard → Webhooks → test): secret-mismatch tussen Clerk-dashboard en Convex env. Verify met `npx convex env list` dat `CLERK_WEBHOOK_SECRET` exact gelijk is aan wat dashboard toont.
- **Webhook 503**: `CLERK_WEBHOOK_SECRET` unset op Convex deployment. Re-set + `npx convex dev --once`.
- **Webhook 404**: deploy is niet recent gedraaid. `npx convex dev --once`.
- **users-row aangemaakt maar geen membership** (Gate 1): controleer of invite-`status` echt `pending` en `expiresAt > now` was bij signup-tijd. Een verlopen invite zou niet auto-accepted worden.
- **Twee users-rows na re-login** (Gate 2): subject-lookup heeft niet idempotently gewerkt. Open bug — niet doorgaan, debuggen.

## Na succes

Documenteer in [`audit-track-record.md`](../conventions/audit-track-record.md): "WP6 Gate 1 + Gate 2 + Gate 3 op dev gepasseerd <datum>". Pre-cutover voor prod: herhaal alle drie tegen prod-deployment-URL, met aparte `CLERK_WEBHOOK_SECRET` + aparte test-users.
