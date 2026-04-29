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
| Users | 8 | ✅ U3-U8 (U1, U2, U5 ❌ eliminated) |
| Groups | 4 | ✅ G1-G4 |
| Albums | 1 | ✅ A1 |
| Photos | 7 | ⏳ |
| Album-photos (publications) | 4 | ⏳ |
| Ratings | 1 | ⏳ |
| Memberships | 2 | ⏳ |

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
| U7 | `userDelToPhotos` | US delete | Delete user's photos (en bijbehorende file storage) | 3 | Cascade in `users.deleteSelf` deletet photo records + scheduler queueet `internal.photos.cleanupStorage` action (best-effort, orphans worden opgeruimd door integrity check) | `tests/users/delete.test.ts` (mutation + scheduled functions assert) + `tests/photos/cleanupStorage.test.ts` (action standalone) | ✅ |
| U8 | `userDelToMemberships` | US delete | Delete user's memberships | 3 | Cascade in `users.deleteSelf`. Note: M2 admin-successie wordt nog niet toegepast — refactor wanneer memberships-domein landt en cascade via `memberships.deleteOne` loopt | `tests/users/delete.test.ts` | ✅ |

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

### Trigger: Photos

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| P1 | `photoChangeToPub` | PO modify | Update denormalized photo-data op albumPhotos | 1+4 | Eliminated. AlbumPhoto query joint photo | `tests/photos/update.test.ts` | ⏳ |
| P2 | `photoChangeToCover` | PO modify | Update denormalized photo-data op group/album covers | 1+4 | Eliminated. Cover query joint photo | `tests/photos/update.test.ts` | ⏳ |
| P3 | `photoDelToPublications` | PO delete | Remove from albumPhotos | 3 | Cascade in `photos.delete` | `tests/photos/delete.test.ts` | ⏳ |
| P4 | `photoDelToRating` | PO delete | Delete ratings on this photo | 3 | Cascade in `photos.delete` | `tests/photos/delete.test.ts` | ⏳ |
| P5 | `photoDelToCover` | PO delete | Clear cover-ref op group/album indien deze foto cover was | 3 (selectief) | In `photos.delete` mutation | `tests/photos/delete.test.ts` | ⏳ |
| P6 | `photoAddToStats` | PO insert | Increment `users.photoCount` | 2 | In `photos.create` mutation | `tests/photos/create.test.ts` | ⏳ |
| P7 | `photoDelToStats` | PO delete | Decrement `users.photoCount` | 2 | In `photos.delete` mutation | `tests/photos/delete.test.ts` | ⏳ |

### Trigger: Album-photos (Publications)

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| AP1 | `groupPhotoAddToMember` | GP insert | Bump `seenPics` array op alle group memberships (behalve uploader) | 2 | **Design decision nodig.** Huidige aanpak: array op membership, zware write-amplification (1 photo upload → N membership writes). Convex alternatieven: (a) zelfde aanpak (array per membership), (b) separate `unseenPhotos` tabel, (c) `lastSeenAt` timestamp + photo `createdAt` voor "nieuw sinds laatste bezoek" logica | `tests/albumPhotos/create.test.ts` | ⏳ |
| AP2 | `groupPhotoDelToMember` | GP delete | Remove entry from `seenPics` arrays | 2 | Volgt uit AP1-keuze | `tests/albumPhotos/delete.test.ts` | ⏳ |
| AP3 | `groupPhotoDelToRating` | GP delete | Clear ratings van group members op deze photo | 3 (selectief) | Cascade in `albumPhotos.delete` (alleen ratings van members van die group) | `tests/albumPhotos/delete.test.ts` | ⏳ |
| AP4 | `groupPhotoDelToCover` | GP delete | Clear album cover indien deze publicatie cover was | 3 (selectief) | In `albumPhotos.delete` mutation | `tests/albumPhotos/delete.test.ts` | ⏳ |

### Trigger: Ratings

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| R1 | `ratingChangeToPhoto` | UF modify/insert | Recompute `photo.ratingAverage` + `ratingCount` | 2 | In `ratings.upsert` mutation | `tests/ratings/aggregate.test.ts` | ⏳ |

### Trigger: Memberships

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| M1 | `memberDelToAlbumPhoto` | UM delete | Remove their albumPhoto entries in this group (uploads die deze user in deze group deed worden uit publicaties gehaald) | 3 (selectief) | Cascade in `memberships.delete` mutation. Let op: photos zelf blijven, alleen publicatie in deze group wordt weggehaald | `tests/memberships/delete.test.ts` | ⏳ |
| M2 | `memberDelToGroup` | UM delete | Admin/founder succession: als geen admin meer over → alle anderen admin maken; als geen founder meer → eerste vinden promoveren. Als geen members meer → group deleten | 2 + 3 | Inline business logic in `memberships.delete` mutation. Bij "no members left" wordt `groups.delete` binnen dezelfde mutation aangeroepen — nested transactional cascade, werkt in Convex (één transactie) | `tests/memberships/delete.test.ts` — minimaal deze scenarios: (a) normaal lid vertrekt, geen succession, (b) admin vertrekt, andere admin aanwezig, geen promotie, (c) laatste admin vertrekt, anderen → admin, (d) founder vertrekt, andere admin → founder, (e) laatste lid vertrekt → group + albums + albumPhotos cascade-deleted | ⏳ |

### Trigger: Stats / signup completion

| # | Oude handler | Trigger event | Effect | Cat | Convex aanpak | Test locatie | Status |
|---|---|---|---|---|---|---|---|
| S1 | `userStatsAddToMembership` | UP insert (na signup) | Auto-accept invite waarmee user uitgenodigd was | n.v.t. | Geen cascade, business logic in signup-flow. Convex: in `users.completeSignup` mutation, of als action triggered door Clerk webhook na user creation | `tests/users/signup.test.ts` (test dat invite-id in user creation leidt tot membership) | ⏳ |

## Open design decisions

1. **AP1: seenPics opslag.** Array per membership versus aparte tabel versus timestamp-based. **Status: deferred** — beslissen tegen de tijd dat het `albumPhotos` domain wordt opgepakt. Tot dan blijven AP1 en AP2 op ⏳ met expliciete "decision pending" markering

## Vastgelegde decisions

- **U7 file storage cleanup:** mutation deletet photo records inline + queued Convex action voor storage cleanup. Action is best-effort, integrity check vangt orphans af. Zie row U7
- **M2 group delete bij laatste lid weg:** nested cascade binnen één Convex mutation. Test-suite dekt 5 scenarios. Zie row M2
- **Cat-4 reactive test pattern:** helper `assertReactive(query, mutation)` die query 2x aanroept rond een mutation en asserteert dat het tweede resultaat afwijkt. Eenmalig bouwen in `tests/_helpers/reactive.ts`, hergebruiken in elke cat-1 test (U3, U4, G1, G2, P1, P2)

## Onderhoud van dit doc

- Elke nieuwe domain-implementatie: lees bovenstaande tabel en check welke rows van toepassing zijn
- Na elke commit van tests: status icon updaten
- Bij design change (bijv. AP1 alternatief b gekozen): notitie in row + open decisions sectie aanpassen
- Bij ontdekken van nieuwe cascade die niet in `mainStream.js` zat (bijv. nieuwe feature): row toevoegen met markering "(nieuw, niet uit AWS)"

## Bron

Oorspronkelijke handlers in `/Users/wintvelt/Documents/DEV/DEV/blob-images-api/handlersDBstreams/`. Dispatcher logica in `mainStream.js`.
