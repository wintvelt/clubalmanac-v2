# WP36: webapp, foto's uploaden

> Regie 2026-11-20. Tweede WP van Fase 4 Track B, bovenop [WP35](./WP35-webapp-bekijken.md). App-WP met een stuk backend. A → besluiten Wouter → B → audit → red-team op het uploadpad vanuit de browser → gate in een browser (dev). WP35 en WP36 gaan samen naar prod (WP35 runbook stap 8–12 wachten hierop). Eigen branch `wp36`.

## Productdoel

Een lid met een Android-telefoon zet in de browser foto's uit zijn galerij in een album van zijn groep. Ze staan rechtop, met hun datum en plaats, en de andere leden zien ze, net als bij een upload vanuit de iPhone-app. Mislukt er iets, bijvoorbeeld op mobiel internet, dan ziet hij welke foto's, en kan hij die opnieuw proberen zonder dat er een foto dubbel komt. Daarnaast kan hij op Profiel een eigen profielfoto uploaden of weghalen. Op een computer werkt het ook.

## Besluiten (Wouter, 2026-11-20)

1. **Alleen uploaden erbij.** Foto's in een album en een eigen profielfoto. Groepsbeheer, het foto-menu, melden en de andere acties blijven op het web weg.
2. **Telefoon eerst:** Chrome op Android is de belangrijkste omgeving, een laptop de tweede.
3. **Twee ingangen, zoals in de app:** een knop "Foto's toevoegen" in het album, en de "+" in de tabbalk (foto's kiezen, dan een album kiezen).
4. **Profielfoto uploaden en weghalen** op Profiel, zoals in de app (WP18 besluit 1: een gewone eigen foto zonder album).
5. **Geen Android-toestel bij Wouter.** Testen in Chrome met de apparaat-emulatie; zie open vraag 7 voor wat die niet dekt.

## Wat er is

- De upload bestaat: `POST /upload` in [`convex/http.ts`](../../convex/http.ts), met een reservering per upload-id tegen dubbele foto's en het album in hetzelfde verzoek ([WP18](./WP18-foto-upload.md)). De iPhone-app stuurt elke foto als JPEG met langste zijde hooguit 4032, zonder EXIF, met de opnamedatum en de locatie als aparte headers; grens 15 MiB. Daarna maakt de backend de formaten ([WP25](./WP25-fotoformaten.md)).
- `/upload` heeft geen CORS ([WP35](./WP35-webapp-bekijken.md) §CORS): een browser kan er nu niet naartoe.
- De webapp (WP35) verbergt alle wijzigknoppen via `readOnly` en toont op de routes buiten scope (`toevoegen` en andere) "Alleen in de app".
- De iPhone-app gebruikt `expo-image-picker` en `expo-image-manipulator` (of vergelijkbaar) voor kiezen en verkleinen; op het web werken die anders of niet.

## Invarianten

1. **Toegang zit in de backend.** Uploaden in een album mag alleen als lid van die groep, net als nu. De browser krijgt geen ruimere rechten dan de iPhone-app.
2. **CORS op `/upload` alleen voor de eigen webadressen** (dezelfde lijst als WP35, `CLUBALMANAC_WEB_ORIGINS`), nooit `*`, geen credentials. De iPhone-app merkt niets.
3. **Geen GPS buiten de backend.** Wat de browser verstuurt, bevat geen EXIF; datum en plaats gaan als dezelfde headers als vanuit de app. Een bestand dat de backend geeft, bevat nooit GPS (WP17d, ongewijzigd).
4. **Rechtop en met datum en plaats.** Een foto uit de browser ziet er in de app en op het web hetzelfde uit als dezelfde foto uit de iPhone-app: draaiing goed, opnamedatum en locatie bewaard. Een foto zonder datum of plaats komt binnen zonder, niet met de datum van vandaag.
5. **Geen dubbele foto's.** Opnieuw proberen na een mislukte of afgebroken upload maakt geen tweede foto (WP18, zelfde reservering).
6. **Geen stille mislukking.** De user ziet per foto wat niet lukte, met een NL-reden en opnieuw proberen. Een bestand dat niet kan (geen beeld, te groot na verkleinen, een formaat dat de browser niet leest) krijgt een duidelijke melding, geen hangende voortgang.
7. **Grote foto's over mobiel internet.** De browser verkleint vóór het versturen (zoals de app). Het geheugen van een telefoon loopt niet vol bij een ronde van veel foto's.
8. **De iPhone-app verandert niet.** De hele testsuite blijft groen; gedeelde code doet op iOS hetzelfde.
9. **De rest blijft alleen-lezen** (WP35 invariant 7), op uploaden en de profielfoto na.

## Scope

- **In:** foto's kiezen (meerdere tegelijk) op Android en op een laptop; verkleinen en EXIF lezen in de browser; uploaden met voortgang, fouten en opnieuw proberen; de twee ingangen (besluit 3); profielfoto uploaden en weghalen; CORS op `/upload`; runbook- en `external-services`-updates.
- **Bewust niet:** foto's met de camera maken vanuit de webapp (tenzij de kiezer van Android dat zelf aanbiedt); een bestaande foto als profielfoto kiezen (dat zit in het foto-menu); slepen als eis (mag, hoeft niet); uploaden onthouden over het sluiten van de browser heen; video's; alle andere acties.

## Open vragen voor A (rapporteren aan regie)

1. **Kiezen.** Werkt `expo-image-picker` op het web (Android Chrome en laptop) met meerdere foto's, of is een eigen `<input type="file" multiple accept="image/*">` beter? Wat geeft Android Chrome terug (bestand, naam, type, EXIF intact of niet)?
2. **Verkleinen en EXIF.** Hoe verkleint de browser naar JPEG ≤ 4032 met de juiste draaiing, en leest hij vooraf datum en GPS uit de EXIF (welke bibliotheek, hoe groot)? Klopt de draaiing in Chrome en Safari (canvas past de EXIF-oriëntatie soms al toe)?
3. **Formaten.** JPEG en PNG zeker. HEIC/HEIF: hoe vaak komt dat op Android of een laptop voor, kan de browser het lezen, en is omzetten (alleen laden als nodig) de moeite waard? WebP?
4. **CORS op `/upload`.** Welke methoden en headers (`Authorization`, `Content-Type`, `X-Upload-Id`, de datum- en locatieheaders), en welke response-headers moet de browser kunnen lezen? Is de bestaande code voor CORS uit WP35 uit te breiden zonder dat de beeldpaden veranderen?
5. **Mobiel netwerk.** Gedrag bij een upload die halverwege stopt, het tabblad dat op de achtergrond gaat, of het scherm dat uitgaat. Hoeveel uploads tegelijk? Moet het scherm wakker blijven (Wake Lock) zoals in de app?
6. **Geheugen.** Een ronde van 50 foto's van 50 MP op een gewone Android-telefoon: hoe voorkomen we dat de browser vastloopt (één voor één verkleinen, bitmaps vrijgeven)?
7. **Testen zonder toestel** (besluit 5). Wat dekt de apparaat-emulatie in Chrome wel en niet (de kiezer van Android, EXIF van een echte camera, geheugen, mobiel netwerk)? Is een Android-emulator op de Mac (Android Studio, gratis) haalbaar voor de gate, ook voor het bekijken uit WP35 (vegen, smal scherm, inloggen)?
8. **Profielfoto.** Welke schermen en functies hergebruikt het web uit de app, en wat moet er voor het web anders?

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is hier nauwelijks bron: het gaat om pariteit met de nieuwe iPhone-app.

## Risico-assessment

- **security/privacy: hoog.** Het uploadpad wordt voor het eerst vanuit een browser bereikbaar (CORS), en foto's bevatten GPS. Red-team op `/upload` vanuit de browser: origins, grootte- en typecontrole, EXIF die toch meegaat, rechten op het album.
- **ops: medium.** Grote bestanden over mobiel internet, afgebroken uploads, geheugen op een telefoon; mislukkingen moeten zichtbaar zijn.
- **external deps: medium.** Browserverschillen (Android Chrome, Safari, desktop) bij kiezen, EXIF en canvas; eventueel een bibliotheek voor EXIF of HEIC.
- **multi-user/concurrency: laag.** De reservering per upload-id bestaat al.
- **data/schema-evolutie: laag.** Naar verwachting geen schemawijziging.
- **ops-runbook-impact:** CORS op `/upload` via dezelfde env-var; aanvulling op [`docs/runbooks/webapp.md`](../runbooks/webapp.md) (gate-stappen voor uploaden, ook op prod in stap 11) en [`external-services.md`](../conventions/external-services.md). B levert ze mee, audit toetst.

## Cross-refs

- WP35 (webapp bekijken, CORS, beeldgeheugen, hosting), WP18 (upload en reservering), WP25 (formaten), WP17d (geen GPS in uitgaande bestanden), WP27 (profiel).
