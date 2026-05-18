# WP5 Mailjet — empirische gates runbook

Twee mens-gates uit [`WP5-email.md` §Empirische gate](../work-packages/WP5-email.md). Bedoeld om vóór cutover (dev nu, prod later) silent-failure-paden en webhook-end-to-end te verifiëren die unit-tests niet kunnen dekken.

Cross-ref: 5 env-vars + Mailjet-config in [`external-services.md` §Email Mailjet](../conventions/external-services.md).

## Pre-flight checklist

### A. Mailjet dashboard

- [x] **API keys genereren** (dev + prod aparte paren). Dashboard → Account Settings → REST API → Master API Key & Sub API Keys → "Create a new API key". Noteer Key + Secret beide; secret is na-aanmaak nooit meer leesbaar.
- [x] **Webhook secret genereren**: bv. `openssl rand -hex 32` lokaal. Dezelfde string straks in Convex env-var én in Mailjet webhook-header-config.
- [ ] **Event API webhook configureren**: dashboard → Account Settings → Event notifications. Add URL `https://mailjet:<MAILJET_WEBHOOK_SECRET>@glorious-pheasant-759.convex.site/email-event` (dev) of `https://mailjet:<SECRET>@<prod-deployment>.convex.site/email-event` (later prod). Event-types: minimaal `bounce` + `blocked` aanvinken. "Group events" aanzetten (Mailjet bundelt events tot 1 POST/sec — onze handler accepteert array én single, zie [`webhookPayloadShape.test.ts`](../../tests/email/webhookPayloadShape.test.ts)). Geen custom-header-stap: Mailjet dashboard ondersteunt 't niet (capability-discovery 2026-05-18, zie [`WP5-email.md` §Webhook-auth correctie](../work-packages/WP5-email.md)). De `<user>:<pass>@` in URL wordt door HTTP-client gestript en als `Authorization: Basic <base64>` header verstuurd — convex-side access-logs zien geen credential in path.
- [ ] **Verified senders bevestigen**: dashboard → Account Settings → Senders & Domains → Domain Authentication. `clubalmanac.com` moet groen staan (DKIM authenticated). Senders `invites@`, `info@`, `dpo@` zijn dan automatisch verified via domain-level DKIM (geen per-adres-verificatie nodig).

### B. Convex dev-deployment env-vars

```bash
npx convex env set MAILJET_API_KEY <key-uit-mailjet>
npx convex env set MAILJET_API_SECRET <secret-uit-mailjet>
npx convex env set MAILJET_WEBHOOK_SECRET <openssl-rand-hex-32>
npx convex env set MAILJET_VERIFIED_SENDERS "invites@clubalmanac.com,info@clubalmanac.com"
npx convex env set CLUBALMANAC_APP_URL "https://clubalmanac.com"
npx convex env set CLUBALMANAC_STAGE "dev"
```

Verificatie: `npx convex env list` toont nu 8 env-vars (2 bestaand + 6 nieuwe).

### C. Test-data in Convex dev DB

Via dashboard → Data → run-mutation interface, of via `npx convex run`:

- [ ] Eén test-user als inviter (kan jij zelf zijn — voeg je echte email toe via Clerk login eerst, dan staat user-record in dev DB)
- [ ] Eén test-group waar inviter member van is
- [ ] (Voor Gate 2) Eén pending invite met email `bounce-test@example.invalid` van die inviter naar die group

## Gate 1 — send-roundtrip (verified-sender silent-failure proof)

**Doel**: bewijzen dat Mailjet send-API daadwerkelijk mail aflevert wanneer sender verified is, én dat de gate hard throwt wanneer sender niet verified is (geen silent slagen).

### Stap 1 — Happy path

1. Via Convex dashboard run-mutation interface: `api.invites.create({ email: "<jouw-persoonlijke-test-inbox>", groupId: <test-group-id>, message: "Gate 1 test" })`. Gebruik gmail/proton/etc., **niet** je webmaster-mail (zelfde inbox als WEBMASTER_EMAILS verwart de routing-toets).
2. Convex scheduler dispatcht `sendInviteEmail` action binnen ~1s.
3. **Check inbox** (en spam-folder voor de zekerheid): mail van `invites@clubalmanac.com` met onderwerp "<inviter-naam> nodigt je uit om lid te worden van «<group-naam>»" moet binnen 30s arriveren.
4. **Check Mailjet dashboard** → Statistics → Sent: één entry voor je test-email, status `Sent` (groen).
5. **Klik de invite-link** in de mail: moet naar `https://clubalmanac.com/invite/<token>` wijzen.

✅ Pass-criterium: mail in inbox, niet in spam, klik leidt naar correcte URL.

### Stap 2 — Silent-failure-gate proof

1. Verwijder tijdelijk `invites@clubalmanac.com` uit `MAILJET_VERIFIED_SENDERS`:
   ```bash
   npx convex env set MAILJET_VERIFIED_SENDERS "info@clubalmanac.com"
   ```
2. Herhaal de `api.invites.create({...})` mutation uit Stap 1.
3. **Check Convex dashboard** → Logs → Action errors: `internal.invites.sendInviteEmail` faalt met `UNVERIFIED_SENDER: invites@clubalmanac.com`.
4. **Check Mailjet dashboard** → Statistics: géén nieuwe entry. Mail is écht niet verstuurd.
5. Restore env-var:
   ```bash
   npx convex env set MAILJET_VERIFIED_SENDERS "invites@clubalmanac.com,info@clubalmanac.com"
   ```

✅ Pass-criterium: action throwt zichtbaar in Convex logs, géén Mailjet-send-poging. Géén silent 200 OK.

## Gate 2 — bounce-roundtrip (webhook end-to-end proof)

**Doel**: bewijzen dat de complete bounce-loop werkt: Mailjet event → `/email-event` webhook met Bearer-auth → `handleBounce` mutation → `inviteBounceEvents` dedup + invite-state-transitie + notify-mail naar inviter. Plus replay-resistance.

### Stap 1 — Pending test-invite

Zorg dat er een pending invite is voor `bounce-test@example.invalid` (zie pre-flight C). Noteer de invite-`_id` en de inviter-email.

### Stap 2 — Trigger synthetisch bounce-event

1. Mailjet dashboard → Account Settings → REST API → Event API.
2. Naast de geconfigureerde webhook-URL zit een "Test event"-knop. Klik 'm.
3. Kies event-type `bounce`. Mailjet stuurt een synthetische payload met `email: bounce-test@example.invalid` (of laat je 't zelf invullen — gebruik dezelfde email als de pending invite).
4. Mailjet POST't de payload naar `https://glorious-pheasant-759.convex.site/email-event` met de geconfigureerde Bearer-header. Response moet 200 zijn (zichtbaar in Mailjet test-event-result-modal).

### Stap 3 — 4-punts verificatie via Convex dashboard

In Convex dashboard → Data:

- **(a) `inviteBounceEvents`-tabel**: één nieuwe rij met de `providerEventId` uit het Mailjet test-event. `processedAt` = ~nu.
- **(b) `invites`-tabel**: het test-invite-record heeft `status: "expired"` en `bouncedAt` is gezet op een timestamp.
- **(c) Replay-test**: klik nogmaals op "Test event" in Mailjet (met dezelfde event-id als de eerste — Mailjet hergebruikt 'm bij dezelfde test). `inviteBounceEvents` blijft 1 rij, géén tweede notify-mail-schedule.
- **(d) Notify-mail naar inviter**: Mailjet dashboard → Statistics → Sent toont één nieuwe mail van `invites@clubalmanac.com` naar de inviter-email met onderwerp "Je uitnodiging voor «<group-naam>» kon niet worden afgeleverd". Check eventueel je eigen inbox als jij de inviter bent.

### Stap 4 — Webhook-auth proof (negatieve test)

Optioneel maar aanbevolen voor extra zekerheid:

```bash
curl -i -X POST https://glorious-pheasant-759.convex.site/email-event \
  -H "Content-Type: application/json" \
  -d '{"event":"bounce","email":"bounce-test@example.invalid","MessageID":"99999"}'
```

Verwacht: HTTP 401, géén state-mutatie (check `inviteBounceEvents` blijft ongewijzigd). Pin't dat een aanvaller zonder Basic-auth-secret de webhook niet kan exploiteren.

✅ Pass-criterium Gate 2: alle 4 punten checken én curl-zonder-Bearer = 401.

## Bij fouten

- **Mail komt in spam**: check DKIM/SPF/DMARC alignment. Mailjet dashboard → Domain Authentication moet groen zijn. Mogelijk DMARC `p=none` (huidige config) is niet sterk genoeg — bij persistente spam-issues overweeg `p=quarantine`.
- **`UNVERIFIED_SENDER` op happy-path**: env-var-waarde checken (`npx convex env list`). Email moet exact in de comma-separated list staan, hoofdletter-insensitive maar geen leading/trailing spaces.
- **Webhook 401 op Mailjet test-event**: webhook-URL in Mailjet dashboard moet `https://mailjet:<SECRET>@...` zijn (let op: username is exact `mailjet`, hardcoded in `convex/http.ts:51`) en `<SECRET>` moet exact gelijk zijn aan `MAILJET_WEBHOOK_SECRET`-env-var. Eén karakter verschil = 401.
- **Webhook 503**: `MAILJET_WEBHOOK_SECRET` is unset op Convex deployment. Re-set via `npx convex env set`.
- **`APP_URL_MISSING` of `STAGE_MISSING`**: betreffende env-var unset of leeg. Set + retry.

## Na succes

Documenteer in [`audit-track-record.md`](../conventions/audit-track-record.md): "WP5 Gate 1 + Gate 2 op dev gepasseerd <datum>".

Voor prod-cutover herhaal alle stappen tegen de prod-deployment-URL, met aparte API-keys/secrets en `CLUBALMANAC_STAGE=prod`.
