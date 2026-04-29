# Cascade Matrix

Inventaris van alle reactive cascades uit de oude `blob-images-api/handlersDBstreams/mainStream.js` (28 handlers), gemapt naar hun Convex-equivalent en test-locatie.

## Doel

1. **Audit:** zorg dat geen cascade vergeten wordt tijdens fase 2
2. **Acceptance criterium per domain:** alle rows met dat entity als trigger gelinkt aan een groene test
3. **Levend document:** Claude Code werkt status bij na elke commit

## Categorieën

| Cat | Naam | Convex aanpak | Test-aspect |
|---|---|---|---|
| **1** | Eliminated (join on read) | Geen cascade. Query joint live via `ctx.db.get(fk)`. UB/UV/US split uit DynamoDB komt vervalt: één `users` table | Test dat query joined data fresh returnt na update |
| **2** | Transactional aggregate | Aggregate veld (photoCount, ratingAverage, etc) wordt in dezelfde mutation atomisch herrekend | Test dat aggregate klopt na elke relevante mutation, en dat scheduled integrity check 'm zou flaggen bij drift |
| **3** | Cascade delete | Parent delete-mutation roept inline children-delete aan, alles in één transactie | Test dat parent delete leidt tot zero orphans |
| **4** | Reactive query coverage | Convex herschikt subscriptions automatisch IF query joint correct (= cat 1 voorwaarde). Test simuleert subscriber via 2x query rond mutatie | Test dat query-resultaat na mutatie verandert zoals verwacht — proxy voor UI rerender |

Een rule kan meerdere categorieën raken (bijv. een delete is cat 3 maar test moet ook cat 4 dekking checken voor subscribed views).

## Test-locatie regel

**Tests leven bij de trigger-mutation, niet bij de affected query.**

- Reden: bij refactor van trigger zie je in `tests/{entity}/` direct wat kapot gaat
- Cross-entity assertions worden binnen de test gemaakt (test setup creëert beide entities)
- Voorbeeld: "user updates avatar → group-members query toont nieuwe avatar" → `tests/users/avatar.test.ts`, niet `tests/groups/`

Uitzondering: queries zonder trigger (puur read-tests) leven bij de query-owner. Bijv. `tests/albums/getAlbumWithMembers.test.ts`.

## Status legenda

- ✅ Test geschreven en groen
- 🚧 Implementatie bezig, test bestaat (mogelijk rood)
- ⏳ Nog niet opgepakt
- ❌ Bewust geschrapt (zie note)

## Domain status

| Domain | Rules | Status |
|---|---|---|
| Users | 10 | ✅ U3-U9; ⏳ U10 (U1, U2, U5 ❌ eliminated) |
| Groups | 4 | ✅ G1-G4 |
| Albums | 2 | ✅ A1, A2 |
| Photos | 7 | ✅ P1-P7 |
| Album-photos (publications) | 4 | ✅ AP1-AP4 |
| Ratings | 1 | ✅ R1 |
| Memberships | 3 | ✅ M1, M2, M3 |
| Flagging | 2 | ⏳ FL1, FL2 |
| Invites | 2 | ✅ IB1; ⏳ IB2 (gebundeld met scheduled-functions werkpakket) |

## Cascade rules

### Trigger: Users

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| U1 | `userBaseChangeToUser` | UB modify/insert | Rebuild aggregated US record | 1 | Eliminated. UB/UV/US split was DynamoDB write-amplification truc; in Convex één `users` table | n.v.t. (vervalt) | ❌ |
| U2 | `userVisitChangeToUser` | UV modify/insert | Rebuild aggregated US record | 1 | Eliminated, zelfde reden | n.v.t. | ❌ |
| U3 | `userBaseChangeToPhoto` | UB modify | Update denormalized user-data op photos | 1+4 | Eliminated. `photos.getWithOwner` joint `ctx.db.get(ownerId)` | `tests/users/profile.test.ts` met `assertReactive` rond `updateProfile` | ✅ |
| U4 | `userChangeToMembership` | US modify | Update denormalized user-data op memberships | 1+4 | Eliminated. `groups.listMembers` joint user | `tests/users/profile.test.ts` met `assertReactive` rond `updateProfile` | ✅ |
| U5 | `userDelToBase` | US delete | Delete UB record | 1 | Eliminated. Eén users-row, één delete | n.v.t. | ❌ |
| U6 | `userDelToRating` | US delete | Delete user's ratings | 3 | Cascade in `users.deleteSelf` mutation | `tests/users/delete.test.ts` | ✅ |
| U7 | `userDelToPhotos` | US delete | Delete user's photos (en bijbehorende file storage) | 3 | Cascade in `users.deleteSelf` roept per photo `internalRemovePhoto` aan, dat transitief P3-P5+P7 afhandelt en per photo een `cleanupStorage` action queueet (best-effort, orphans → integrity check) | `tests/users/delete.test.ts` (mutation + per-photo scheduled functions assert) + `tests/photos/cleanupStorage.test.ts` (action standalone) | ✅ |
| U8 | `userDelToMemberships` | US delete | Delete user's memberships | 3 | Cascade in `users.deleteSelf`. Note: M2 admin-successie wordt nog niet toegepast — refactor wanneer memberships-domein landt en cascade via `memberships.deleteOne` loopt | `tests/users/delete.test.ts` | ✅ |
| U9 | (nieuw, niet uit AWS) | US delete | Delete user's `albumLastSeen` records | 3 | Cascade in `users.deleteSelf` via `deleteAlbumLastSeenByUser` helper (by_user index) | `tests/users/delete.test.ts` (describe `U9`) | ✅ |
| U10 | (nieuw, niet uit AWS) | US delete | Clear `flaggedBy` ref op photos die deze user heeft geflagd (default: photo en flag-state blijven, alleen `flaggedBy` op `undefined` om orphan ref te voorkomen). Alternatief: hele flag clearen — open beslissing | 3 (selectief) | In `users.deleteSelf`: scan `photos.by_flagged` (op flaggedAt aanwezig), filter op `flaggedBy === userId`, patch `flaggedBy = undefined`. Owner van photo en deletion countdown ongewijzigd | `tests/users/delete.test.ts` (describe `U10`: photo door deleted user geflagd → flaggedBy weg, flaggedAt + flaggedDeleteDate intact) | ⏳ |

### Trigger: Groups

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| G1 | `groupChangeToMembership` | GB modify | Update denormalized group-data op memberships | 1+4 | Eliminated. `groups.listMine` joint group | `tests/groups/update.test.ts` met `assertReactive` rond `groups.update` | ✅ |
| G2 | `groupChangeToAlbum` | GB modify | Update denormalized group-data op albums | 1+4 | Eliminated. Nieuwe `albums.getWithGroup` joint group | `tests/groups/update.test.ts` met `assertReactive` rond `groups.update` | ✅ |
| G3 | `groupDelToMembers` | GB delete | Delete memberships | 3 | Cascade in `groups.remove` | `tests/groups/crud.test.ts` (describe `groups.remove`) | ✅ |
| G4 | `groupDelToAlbums` | GB delete | Delete albums | 3 | Cascade in `groups.remove` (en transitief `albumPhotos`, zie A1) | `tests/groups/crud.test.ts` (describe `groups.remove`) | ✅ |

### Trigger: Albums

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| A1 | `albumDelToAlbumPhoto` | GA delete | Delete albumPhotos (publicaties) | 3 | Cascade in `albums.remove` | `tests/albums/crud.test.ts` (describe `albums.remove > cascade albumPhotos`) | ✅ |
| A2 | (nieuw, niet uit AWS) | GA delete | Delete `albumLastSeen` records voor deze album | 3 | Cascade in `albums.remove` via `deleteAlbumLastSeenByAlbum` helper (by_album index) | `tests/albums/lastSeenCascade.test.ts` | ✅ |

### Trigger: Photos

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| P1 | `photoChangeToPub` | PO modify | Update denormalized photo-data op albumPhotos | 1+4 | Eliminated. `albums.listPhotos` joint photo | `tests/photos/update.test.ts` met `assertReactive` rond `photos.update` | ✅ |
| P2 | `photoChangeToCover` | PO modify | Update denormalized photo-data op group/album covers | 1+4 | Eliminated. Nieuwe `groups.getWithCover` + `albums.getWithCover` joint photo | `tests/photos/update.test.ts` met `assertReactive` rond `photos.update` | ✅ |
| P3 | `photoDelToPublications` | PO delete | Remove from albumPhotos | 3 | Cascade in `photos.remove` (via `internalRemovePhoto`) | `tests/photos/delete.test.ts` | ✅ |
| P4 | `photoDelToRating` | PO delete | Delete ratings on this photo | 3 | Cascade in `photos.remove` | `tests/photos/delete.test.ts` | ✅ |
| P5 | `photoDelToCover` | PO delete | Clear cover-ref op group/album indien deze foto cover was | 3 (selectief) | In `photos.remove` mutation, full-table scan over groups/albums (acceptabel bij huidige schaal — TODO `by_cover` index als nodig) | `tests/photos/delete.test.ts` | ✅ |
| P6 | `photoAddToStats` | PO insert | Increment `users.photoCount` | 2 | In `photos.create` mutation | `tests/photos/create.test.ts` | ✅ |
| P7 | `photoDelToStats` | PO delete | Decrement `users.photoCount` | 2 | In `photos.remove` mutation | `tests/photos/delete.test.ts` | ✅ |

### Trigger: Album-photos (Publications)

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| AP1 | `groupPhotoAddToMember` | GP insert | Bump `seenPics` array op alle group memberships (behalve uploader) | 1 | Eliminated. Vervangen door `albumLastSeen` timestamp + live count query in `albums.listByGroupWithUnread`: range scan `albumPhotos.by_album_added(albumId, addedAt > effective)`, filter `photo.ownerId != currentUser`, met `effectiveLastSeen = albumLastSeen?.lastSeenAt ?? max(album.createdAt, membership.joinedAt)`. Geen cascade op upload, geen write-amplification | `tests/albums/unreadCount.test.ts` | ✅ |
| AP2 | `groupPhotoDelToMember` | GP delete | Remove entry from `seenPics` arrays | 1 | Eliminated. Live count query corrigeert vanzelf bij delete. Geen cascade nodig | `tests/albums/unreadCount.test.ts` (describe `AP2`) | ✅ |
| AP3 | `groupPhotoDelToRating` | GP delete | Clear ratings van users die door de unpublication geen access meer hebben tot de photo | 3 (selectief) | In `albums.removePhoto`: per rating op deze photo, skip als rater de owner is OF nog membership heeft in een group waar de photo nog elders gepubliceerd staat. Recompute aggregate na delete. Matcht originele AWS-handler `groupPhotoDelToRating` (`getPhotoById` access-check) | `tests/albumPhotos/delete.test.ts` (incl. multi-group preservation + owner-skip) | ✅ |
| AP4 | `groupPhotoDelToCover` | GP delete | Clear album cover indien deze publicatie cover was | 3 (selectief) | In `albums.removePhoto` mutation, simple equality patch | `tests/albumPhotos/delete.test.ts` | ✅ |

### Trigger: Ratings

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| R1 | `ratingChangeToPhoto` | UF modify/insert | Recompute `photo.ratingAverage` + `ratingCount` | 2 | `recomputeRatingAggregate` helper aangeroepen vanuit `ratings.upsert` én `ratings.remove` | `tests/ratings/aggregate.test.ts` | ✅ |

### Trigger: Memberships

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| M1 | `memberDelToAlbumPhoto` | UM delete | Remove their albumPhoto entries in this group (uploads die deze user in deze group deed worden uit publicaties gehaald) | 3 (selectief) | In `groups.removeMember`: filter `albumPhotos.by_group` op `addedBy === userId` en delete. Photos zelf blijven (eigendom users), andere groups intact | `tests/memberships/delete.test.ts` | ✅ |
| M2 | `memberDelToGroup` | UM delete | Admin/founder succession + group cleanup. (a) member vertrekt → niets, (b) admin met andere admin → niets, (c) laatste admin → allen admin, (d) founder → eerste admin wordt founder, (e) laatste lid → group + albums + albumPhotos cascade | 2 + 3 | Inline business logic in `groups.removeMember` na membership-delete. Nested transactional cascade voor case (e). Vervangt vorige "laatste admin kan niet weg" foutmelding | `tests/memberships/delete.test.ts` — alle 5 scenarios + 2 M1 tests | ✅ |
| M3 | (nieuw, niet uit AWS) | UM delete | Delete `albumLastSeen` records voor die user × albums in die groep | 3 | In `groups.removeMember` via `deleteAlbumLastSeenForUserInGroup` helper: by_user op userId, filter op album.groupId == this group. Andere groepen blijven intact | `tests/memberships/delete.test.ts` (describe `M3`) | ✅ |

### Trigger: Flagging (scheduled / appeal flow)

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| FL1 | (nieuw, niet uit AWS — was niet expliciet in oude code, mogelijk handmatig) | Daily cron | Auto-delete photos waar `flaggedDeleteDate < now` (en niet onder appeal) | 3 | Convex scheduled cron `cleanupFlaggedPhotos`: scan `photos.by_flagged_delete`, filter `flaggedDeleteDate < now && !flaggedAppealDate || flaggedAppealDenyDate`, roep `internalRemovePhoto` per match aan (transitief P3-P5+P7) | `tests/photos/flagCleanup.test.ts` (cron logica, fake clock voor 14d/7d countdowns) | ⏳ |
| FL2 | `flagPhotoDecide.js` (deny-pad) | webmaster denies appeal | Email naar owner met decision + uitleg | n.v.t. (action, geen cascade) | `decideFlag` mutation queue't email-action via `ctx.scheduler.runAfter(0, ...)`, action verstuurt via Resend/SendGrid | `tests/photos/decideFlag.test.ts` (assert: email-action gequeue'd bij deny, niet bij approve) | ⏳ |

### Trigger: Invites (system events)

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| IB1 | (nieuw, niet uit AWS — oude code had geen bounce-feedback loop) | Email provider bounce webhook | Markeer alle pending invites voor email als `expired` + zet `bouncedAt`, queue notify-mail naar inviter, dedup via `inviteBounceEvents` | 2 + 3 | `internal.invites.handleBounce` aangeroepen via `convex/http.ts` webhook endpoint. Patcht invite-records, queue't `sendInviteEmail({kind:"bounced"})`, schrijft providerEventId-record voor dedup | `tests/invites/bouncedHandler.test.ts` | ✅ |
| IB2 | (nieuw, niet uit AWS) | Daily cron | Patch invites met `status="pending"` en `expiresAt < now` naar `status="expired"` (natural expiry, los van bounce) | 3 | Convex scheduled cron `expirePendingInvites` (gebundeld met flagging-cron werkpakket — nog niet geleverd) | `tests/invites/naturalExpiry.test.ts` (volgt bij scheduled-functions werkpakket) | ⏳ |

### Trigger: Stats / signup completion

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| S1 | `userStatsAddToMembership` | UP insert (na signup) | Auto-accept invite waarmee user uitgenodigd was | n.v.t. | Geen cascade, business logic in signup-flow. Convex: in `users.completeSignup` mutation, of als action triggered door Clerk webhook na user creation | `tests/users/signup.test.ts` (test dat invite-id in user creation leidt tot membership) | ⏳ |

## Open design decisions

1. **U10 cleanup-keuze bij user delete.** Default in matrix: clear alleen `flaggedBy`, flag-state blijft. Alternatief: hele flag clearen (als melder weg = melding vervalt). Default lijkt verdedigbaar — content-inappropriateness staat los van flagger-bestaan, en de webmaster ziet 'm nog in queue. Heroverwegen indien er use cases opduiken

## Vastgelegde decisions

- **U7 file storage cleanup:** mutation deletet photo records inline + queued Convex action voor storage cleanup. Action is best-effort, integrity check vangt orphans af. Zie row U7
- **Transitieve cascade door photos:** `users.deleteSelf` cascadet niet langer photo-records direct, maar via `internalRemovePhoto` (helper in `convex/photos.ts`). Daarmee krijg je P3-P5+P7 cascades automatisch mee, voorkomt orphan ratings/albumPhotos/cover-refs
- **M2 group delete bij laatste lid weg:** nested cascade binnen één Convex mutation. Test-suite dekt 5 scenarios. Zie row M2
- **Cat-4 reactive test pattern:** helper `assertReactive(query, mutation)` die query 2x aanroept rond een mutation en asserteert dat het tweede resultaat afwijkt. Eenmalig bouwen in `tests/_helpers/reactive.ts`, hergebruiken in elke cat-1 test (U3, U4, G1, G2, P1, P2)
- **AP1/AP2 seenPics opslag:** timestamp-based via aparte `albumLastSeen` table met (userId, albumId, lastSeenAt). Schrijven alleen bij album-open. Count live berekend via range scan op photos.by_album_created. Fallback bij ontbrekend record: `max(album.createdAt, membership.joinedAt)`. Geen pre-create cascade bij member-join of album-create. Eigen uploads tellen niet mee. Group-level "markeer alles gelezen" mutation als escape hatch voor nieuwe members. Cascade-cleanup: A2 (album delete), U9 (user delete), M3 (membership delete). Zie design-sectie in [migratie-plan-convex.md](./migratie-plan-convex.md)
- **Webmaster-rol implementatie:** env-var based via `WEBMASTER_EMAILS` (comma-separated) per Convex deployment, helper `requireWebmaster(ctx)` matcht `ctx.auth.getUserIdentity().email`. 1:1 met oude AWS aanpak (hardcoded email). YAGNI keuze: Clerk publicMetadata of DB-flag is flexibeler maar onnodig bij 16 users + 1 webmaster. Webmaster-gated operations: `decideFlag`, `listAllFlagged`, `features.update`, `features.remove`, plus problem-report email-bestemming. Bootstrap: jouw email vooraf in Clerk dashboard, env-var zetten in prod deployment. Zie webmaster-rol sectie in [migratie-plan-convex.md](./migratie-plan-convex.md)

## Onderhoud van dit doc

- Elke nieuwe domain-implementatie: lees bovenstaande tabel en check welke rows van toepassing zijn
- Na elke commit van tests: status icon updaten
- Bij design change (bijv. AP1 alternatief b gekozen): notitie in row + open decisions sectie aanpassen
- Bij ontdekken van nieuwe cascade die niet in `mainStream.js` zat (bijv. nieuwe feature): row toevoegen met markering "(nieuw, niet uit AWS)"

## Bron

Oorspronkelijke handlers in `/Users/wintvelt/Documents/DEV/DEV/blob-images-api/handlersDBstreams/`. Dispatcher logica in `mainStream.js`.
