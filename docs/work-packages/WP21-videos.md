# WP21: clubfilms bekijken

> Regie 2026-11-15. App-WP met een stuk backend. A → besluiten Wouter → B → audit → red-team op de toegang tot de films → gate in de simulator (dev). Eigen branch `wp21`. Na WP20, vóór T0.

## Productdoel

Een lid dat de clubfilms mag zien, vindt ze in de app in een lijst met covers en speelt ze direct af, ook de langste film, zonder hem eerst helemaal te downloaden. Wie ze niet mag zien, krijgt ze niet te zien, ook niet met een link die iemand anders doorstuurt.

## Wat er is

- 10 clubfilms (~19 GB, één van 5,8 GiB) en 9 cover-PNG's in S3-bucket `blob-videos`. Geen DynamoDB-record; de oude app heeft de lijst vast in de front-end (migratie-status Track A punt 9, README WP-TBD R2).
- De films gaan niet naar Convex (besluit 2026-08-23, WP12 §Video's). De bron blijft S3 tot een latere R2-overstap; `blob-videos` blijft ook na T+30 staan.
- De nieuwe app en backend hebben nog niets voor films.

## Invarianten

1. **Toegang zit in de backend.** De lijst, de covers en een afspeellink krijgt alleen wie de film mag zien. Een onbekende film en een film zonder toegang geven dezelfde weigering (WP24). Wie "mag zien" betekent, volgt uit de oude app (vraag 2) en de Toegangsdefinities in [`work-package-specs.md`](../conventions/work-package-specs.md).
2. **Een link is kort geldig.** De app krijgt geen vaste, openbare URL naar een film of cover. Een doorgestuurde link werkt hooguit een korte tijd (de duur is een besluit) en daarna niet meer.
3. **Geen AWS-sleutel buiten de backend.** De app ziet geen sleutel. De sleutel in Convex mag alleen lezen uit `blob-videos`, niets anders. Hij staat niet in logs, fouten of antwoorden.
4. **Afspelen begint snel.** De film streamt; je kunt verder spoelen zonder het hele bestand te laden. Dat geldt ook voor de film van 5,8 GiB.
5. **Geen stille mislukking.** Een verlopen link, een S3-storing of een ontbrekend bestand geeft een NL-melding met opnieuw proberen. Opnieuw proberen haalt een verse link.
6. **Geen onnodige kosten.** S3 rekent per bekeken GB. De app speelt niet vanzelf af, laadt geen films vooruit en bewaart geen film op de telefoon. Een cover is klein en mag wel in de cache.
7. **Een ontbrekende cover is geen fout.** Er zijn 9 covers voor 10 films; zonder cover krijgt de film een nette tegel.
8. **Toegang wordt per verzoek bepaald.** Wie geen lid meer is of zijn account verwijdert, krijgt vanaf dat moment geen nieuwe link meer.

## Scope

- **App:** een plek met de films (waar precies: vraag 4), lijst met cover en titel, afspelen met de standaard-speler van iOS (volledig scherm, spoelen, AirPlay als het vanzelf werkt).
- **Backend:** de lijst van films met hun toegang, en een korte link per film en per cover, na toegangscheck.
- **Bewust niet:** films uploaden, wijzigen of verwijderen in de app; downloaden of delen van een film; de R2-overstap; de webapp; ondertiteling of hoofdstukken.

## Open vragen voor A (oude app en backend, rapporteren aan regie)

1. Hoe bouwt de oude app de lijst: titels, volgorde, welke cover bij welke film, en waar staat dat (front-end, config, backend)?
2. Wie mag in de oude app de films zien: iedereen die ingelogd is, alleen leden van één groep (welke), of per film een groep? Hoe dwingt v1 dat af?
3. Hoe haalt de oude app een film op: is `blob-videos` openbaar, met vaste URL's, of via signed URL's / CloudFront? Is de bucket nu openbaar te lezen? (Als ja: besluit nodig, want dichtzetten raakt de oude app tot T0.)
4. Waar stonden de films in de oude app (tab, groepsscherm, apart scherm)?
5. Bestanden: formaat (MP4/MOV, codec), grootte per film, en staat de index vooraan in het bestand (`faststart`)? Zonder dat moet de speler het hele bestand halen voor hij start (raakt invariant 4).
6. Regio van de bucket, en is er al een IAM-gebruiker of -rol die alleen leest uit `blob-videos`?
7. Hoe vaak werden de films bekeken (S3- of CloudFront-logs, als die er zijn)? Voor de kosten-inschatting.

A rapporteert ook wat hier ontbreekt of niet klopt.

## Risico-assessment

- **security/privacy: hoog** — privé-films van de club; nieuwe sleutel met leesrecht op S3 in Convex prod; korte links die doorgestuurd kunnen worden. Red-team op de toegang en de links.
- **ops: medium** — de app hangt na T0 nog aan AWS. Een verlopen of ingetrokken sleutel, of een gewiste bucket, laat de films stil verdwijnen als niets dat meldt. Kosten: ~€0,08 per bekeken GB (2 GB × 10 keer ≈ €1,60 per maand), binnen €15 zolang er niet veel gekeken wordt.
- **external deps: medium** — S3 (signing, regio, CORS niet nodig voor native), video-afspelen in Expo (`expo-video`) met range-requests.
- **multi-user/concurrency: laag** — alleen lezen.
- **data/schema-evolutie: laag** — hooguit een kleine tabel (10 films) of een vaste lijst in de backend; geen bestaande data geraakt. Komt er een tabel, dan moet de migratie of een seed hem vullen (ook op prod bij T0).
- **ops-runbook-impact:** nieuwe env-vars voor de S3-sleutel (namen kiest B) op dev en prod, met fail-loud als ze ontbreken; IAM-gebruiker met alleen `s3:GetObject` op `blob-videos/*`; entry in [`external-services.md`](../conventions/external-services.md) en een T-4-weken-regel in [`migratie-status.md`](../migratie-status.md). Wouter maakt de IAM-sleutel zelf aan.

## Cross-refs

- migratie-status: Track A punt 9; cutover T+30 (`blob-videos` blijft staan).
- migratie-plan: §Video streaming (regel ~185), datavolume (regel ~55).
- WP12 §Video's (waarom de films niet naar Convex gaan).
- README: WP-TBD "Video's van S3 naar Cloudflare R2".
- oude code (alleen A): `clubalmanac-app` (lijst, speler), `blob-images-api*` (als er een video-endpoint is).

## Acceptance

- Tests: toegang (wel/geen lid, ex-lid, verwijderd account, onbekende film: dezelfde weigering), korte link (verloopt, alleen voor die film), geen sleutel in antwoorden, fail-loud bij ontbrekende env-vars, app-gedrag bij een mislukte of verlopen link.
- Gate in de simulator (dev): lijst met covers, de grootste film afspelen en verder spoelen, een verlopen link geeft een nette melding en opnieuw proberen werkt, een niet-lid ziet niets. Daarna kijken of er geen film op schijf staat.

---

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-15. Bronnen: oude app (`GroupFilmsSub`, `Movie`, `Group`), de `blob-images-api*`-repos (geen video-endpoint), een alleen-lezende S3-listing met de migratie-leessleutel, en anonieme `HEAD`- en kleine range-verzoeken op de bestanden (paar MB in totaal, niets gewijzigd).
>
> **De repo is publiek en de bestanden in `blob-videos` zijn per stuk openbaar te lezen.** Deze spec noemt daarom geen bestandsnamen. De volledige lijst (bestand, cover, titel, jaar, volgorde, grootte, duur, `faststart`) staat in `scripts/.data/wp21/films.json` (gitignored). Tests gebruiken verzonnen sleutels.

### Antwoorden op de open vragen

1. **Lijst.** Vast in de front-end van de oude app: 2 trailers (Georgië 2022, Colombia 2016) en 7 films (Georgië 2022, Colombia 2016, Zuid-Afrika 2011, Marokko 2006, Sulawesi 2001, Lapland 1996, Tanzania 1991), in die volgorde, onder de kopjes "Trailers" en "Blockbusters". Elk item heeft titel, jaar, film en cover. De tegel toont alleen de cover; titel en jaar worden niet getoond.
2. **Wie mag kijken.** Alleen in de app, op groep-ID's die in de code staan. De tab Films verschijnt in twee prod-groepen: "Blob bibliotheek" en "Test group". De films staan alleen in "Blob bibliotheek"; "Test group" ziet alleen de trailers. Op prod zijn alle 20 users lid van "Blob bibliotheek". De backend controleert niets: de app krijgt het groepsscherm alleen als lid, maar de film-URL's zijn openbaar en blijven altijd werken.
3. **Ophalen.** Vaste, openbare S3-URL's, zonder CloudFront of ondertekende links. **De bestanden zijn nu anoniem te lezen** (`HEAD` zonder sleutel geeft 200 op films en covers, ook op het bestand dat de oude app niet gebruikt). De bucket-lijst is anoniem dicht (403). Of dat via een bucket-policy of via object-ACL's loopt, kan de leessleutel niet zien. Dichtzetten breekt de oude app: besluit 4.
4. **Plek.** Tab "Films" in het groepsscherm, tussen Albums en Leden, alleen in de groepen uit vraag 2. Een tik op een tegel opent een eigen scherm met de speler; de film start meteen en het geluid speelt ook als de stille modus aan staat.
5. **Bestanden.** Alle tien MP4/M4V met H.264-beeld en AAC-geluid; iOS speelt ze zonder omzetten. Groottes van 9 MB tot 5,80 GiB, samen 19,1 GB. Resolutie van 384×288 tot 1920×1080. Duur van 1 tot 89 minuten. De drie 1080p-films lopen op ~19 Mbit/s. **Zeven hebben de index vooraan (`faststart`), drie niet** (Marokko, Sulawesi, Lapland; 0,3 tot 1,65 GiB). De grootste film (Georgië) heeft hem wel vooraan. S3 ondersteunt range-verzoeken.
6. **Regio en sleutel.** `eu-central-1` (Frankfurt). Er is één IAM-gebruiker met leesrecht op deze bucket: de migratie-leessleutel (lijst en lezen; geen bucket-instellingen). Die is niet bruikbaar voor Convex, want hij is bedoeld voor de migratie en mag meer dan alleen deze bucket lezen. Een nieuwe gebruiker is dus nodig.
7. **Kijkcijfers.** Niet te achterhalen: er is geen CloudFront, en de leessleutel mag de log-instelling van de bucket niet lezen. Wouter kan het in AWS Cost Explorer zien (S3, uitgaand verkeer in `eu-central-1`).

### Wat in de draft niet klopt

- **"10 films, 9 covers"**: de oude app toont 9 items (7 films en 2 trailers), elk met een cover. Het tiende bestand is een tweede versie van de Colombia-film (24 min) die de oude app niet gebruikt: besluit 5. Invariant 7 blijft gelden, maar als randgeval.
- **"Een cover is klein"**: de covers zijn PNG's van 0,6 tot 5,6 MB, samen 21 MB. Zonder cache haalt elk bezoek aan de lijst dat opnieuw op.
- **Kosten**: één keer Georgië helemaal kijken is 6,2 GB, niet 2. AWS geeft per account 100 GB uitgaand verkeer per maand gratis; daarboven ~$0,09 per GB. Bij dit gebruik blijft het naar verwachting gratis.
- **Invariant 2 en lange films**: een link wordt bij **elk** range-verzoek opnieuw gecontroleerd, ook halverwege de film en na spoelen. Verloopt de link tijdens het kijken, dan stopt de film. Een korte link (minuten) breekt dus invariant 4. Zie besluit 2.
- **Invariant 3**: een ondertekende S3-link bevat altijd de *access key ID* van de sleutel (niet het geheim). Dat is hoe S3 werkt en is geen lek. De invariant gaat over het geheim.

### Aanvullende invarianten

9. **Geen bestandsnaam of bucket-URL in de repo** zolang de bestanden openbaar te lezen zijn. De lijst komt uit data die per omgeving gevuld wordt (seed op dev, migratie of seed op prod bij T0), niet uit code. Tests gebruiken verzonnen sleutels.
10. **Alleen bekende films.** De backend tekent alleen een link voor een bestand uit zijn eigen lijst. Een sleutel of pad uit het verzoek wordt nooit ondertekend; de app vraagt per film-id.
11. **Eén weigering.** Onbekende film, film zonder toegang, niet ingelogd, account in verwijdering en verwijderd account geven dezelfde weigering, net als in WP24. De lijst geeft wie niet mag kijken geen films (leeg), en geen hint dat er films zijn.
12. **Toegangsdefinitie** ([`work-package-specs.md`](../conventions/work-package-specs.md) §Toegangsdefinities): het film-id is zichtbaar in de lijst en in de link-verzoeken. Elk publiek pad dat een film-id aanneemt, staat in een inventaristest en heeft dezelfde toegangscheck. Er komt geen publiek pad dat de lijst of de toegang wijzigt; vullen gaat via een intern pad of seed.
13. **Link per film en per soort.** Een link voor de cover van film X opent niet de film X, en niet een andere film of cover.
14. **Verder kijken na een fout.** Mislukt het afspelen halverwege (verlopen link, netwerk), dan haalt "opnieuw proberen" een verse link en gaat verder waar de kijker was, niet vanaf het begin.
15. **Geen film op schijf.** De speler gebruikt geen cache op schijf en de app biedt geen download. Covers mogen in de cache, met een vaste cache-sleutel per cover: de link verandert per verzoek, dus zonder vaste sleutel wordt elke cover elke keer opnieuw gehaald.
16. **Na T0 stil verdwijnen voorkomen.** Een ingetrokken of verlopen sleutel merkt de backend niet bij het tekenen (dat gebeurt lokaal), alleen de speler krijgt een 403. Zie besluit 7.
17. **Toegang en link in hetzelfde verzoek.** De check gebeurt bij elk link-verzoek opnieuw (invariant 8), niet uit een eerder resultaat in de app. Een al uitgegeven link blijft werken tot hij verloopt: dat restrisico is precies de linkduur uit besluit 2.

### A-keuzes

- **Pariteit met de oude app**: zelfde volgorde, kopjes "Trailers" en "Blockbusters", geluid ook in de stille modus, liggend afspelen, iOS-speler met spoelen en AirPlay. Wél titel en jaar onder de tegel (de draft vraagt dat).
- **Geen auto-play in de lijst**, wel direct starten op het filmscherm: de tik op de tegel is de keuze om te kijken.
- **De lijst staat in de data, niet in code**, met per film de toegang (besluit 1). In v2 heeft een groep geen oud v1-ID, dus een vast groep-ID in code kan niet. Vullen op prod hoort in de T0-stappen.
- **Testbaar zonder AWS**: tests pinnen toegang, weigering, welke sleutel ondertekend wordt, de duur in de link en fail-loud bij ontbrekende env-vars. Afspelen zelf zit in de simulator-gate.
- **`expo-video` is een native module**: er is een nieuwe dev-build nodig voor de gate, en een nieuwe app-build voor prod.

### Besluiten voor Wouter

1. **Wie mag de films zien?** (a) Leden van "Blob bibliotheek", trailers en films (aanbevolen; nu alle 20 users). (b) Iedereen met een account. (c) Per film een groep. Daarbij: vervalt "Test group ziet trailers"? Aanbevolen: ja.
2. **Hoe lang werkt een link?** De link moet een hele film plus pauze overleven (langste film 89 min). Aanbevolen: **3 uur voor een film**, met verder kijken na een fout (invariant 14). Een doorgestuurde link werkt dan hooguit 3 uur, voor één film. Cover-links mogen korter.
3. **Bucket dichtzetten: wanneer?** Nu zijn de bestanden openbaar; dichtzetten breekt de oude app. Aanbevolen: **op T0**, nadat de nieuwe app op prod een film afspeelt; Wouter zet "Block public access" aan in de AWS-console. Dat wordt een T0-regel in `migratie-status.md`. Tot dan blijft het restrisico dat wie een oude URL heeft (bijvoorbeeld uit de oude app), kan blijven kijken.
4. **Bestandsnamen uit de publieke repo houden** (invariant 9)? Aanbevolen: ja, ook na het dichtzetten.
5. **Het tiende bestand** (tweede Colombia-versie, 3,2 GiB, niet in de oude app): aanbevolen **niet tonen**.
6. **De drie films zonder `faststart`**: eerst in de simulator-gate testen of Sulawesi (1,65 GiB) snel start en spoelt. Doet hij dat niet, dan zet Wouter ze om (zonder kwaliteitsverlies, alleen de index naar voren) en vervangt hij ze in S3. Aanbevolen: eerst testen.
7. **Bewaking van de sleutel**: de dagelijkse monitoring-check controleert ook dat één cover met een ondertekende link te lezen is, en mailt bij een fout. Aanbevolen: ja (kleine toevoeging, dekt invariant 16).

Covers blijven PNG's uit S3 met cache (geen besluit nodig, tenzij Wouter ze kleiner wil).

## Besluiten Wouter (2026-11-15)

Alle adviezen van A overgenomen.

1. **Wie kijkt:** leden van "Blob bibliotheek", trailers en films. "Test group" ziet geen films meer.
2. **Linkduur:** 3 uur voor een film; cover-links mogen korter. Na een fout kijk je verder waar je was (invariant 14).
3. **Bucket dicht op T0**, nadat de nieuwe app op prod een film afspeelt. Wouter zet "Block public access" aan. Regel in `migratie-status.md` (regie, closeout).
4. **Geen bestandsnamen of bucket-URL in de repo** (invariant 9), ook na het dichtzetten.
5. **Het tiende bestand niet tonen.**
6. **Films zonder `faststart`:** eerst testen in de gate; pas omzetten als ze traag starten of spoelen.
7. **Bewaking:** de dagelijkse monitoring-check leest één cover via een ondertekende link en mailt bij een fout.
