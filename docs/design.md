# Design: richting C+

Bron voor de thema-code (WP-Design stap 7) en voor elke feature-WP (15–21). Wat hier niet staat, vult een WP aan in de tokens. Een WP wijkt niet lokaal af (invariant 2).

Mockups: Artifact "Clubalmanac stijlrichtingen" (privé, Wouter), versie 11 en later: https://claude.ai/artifact/C7HY7q5JRtCD8BK82ZZjbk. Alle inhoud daarin is verzonnen (invariant 8).

## 1. Richting

C+ is richting C (Foto voorop) met een lime-sky-verloop en de jaartallen uit richting B. Besluit van Wouter, 2026-10-25:

| Onderdeel | Keuze |
|---|---|
| Basis | iOS-eigen: systeemletter, grote titels, gegroepeerde lijsten zoals Instellingen |
| Verloop | lime-400 naar sky-500, 38% lime: sky-500 is vol vanaf 76% |
| Actiekleur | Oranje, voor de hoofdactie en de "nieuw"-labels |
| Links, terug, actieve tab | Sky (blauw) |
| Jaartallen | Literata, groot, boven de albums van dat jaar |
| Label onder de + | "Toevoegen" (akkoord Wouter, invariant 1) |
| Icoon | Polaroid met eend, in lagen voor Liquid Glass (§8) |

Lime komt alleen in het verloop, nooit als tekst of icoon op wit (1,3:1).

## 2. Kleurtokens

Het contrast is berekend met de WCAG-formule. Norm: 4,5:1 voor tekst, 3:1 voor grote tekst, iconen en randen.

| Token | Licht | Donker | Gebruik | Contrast licht / donker |
|---|---|---|---|---|
| `bg` | `#F1F5F9` | `#020617` | schermachtergrond | — |
| `surface` | `#FFFFFF` | `#0F172A` | kaarten, lijstblokken, meldingen | — |
| `text` | `#0F172A` | `#E2E8F0` | gewone tekst | 16,3 / 16,4 op `bg` |
| `muted` | `#475569` | `#94A3B8` | tweede regel, meta | 7,6 / 7,0 op `surface` |
| `line` | `#E2E8F0` | `#1E293B` | scheidingslijnen (decoratief) | — |
| `primary` | `#0369A1` | `#7DD3FC` | links, terug, actieve tab, jaartal | 5,9 / 10,7 op `surface` |
| `cta` | `#C2410C` | `#FB923C` | hoofdknop, "nieuw"-label | — |
| `onCta` | `#FFFFFF` | `#1C0A02` | tekst op `cta` | 5,2 / 8,5 |
| `ctaText` | `#9A3412` | `#FB923C` | oranje tekstknop | 6,7 / 8,9 op `bg` |
| `tabbar` | `#F8FAFC` | `#0B1222` | tabbalk | — |
| `tabInactive` | `#475569` | `#94A3B8` | inactieve tab | 7,2 / 7,3 |
| `tabPill` | `#E0F2FE` | `#0C4A6E` | pil achter actieve tab | `primary` erop: 5,2 / 5,7 |
| `segBg` | `#E2E8F0` | `#1E293B` | balk groepstabs | — |
| `segOn` | `#0369A1` | `#7DD3FC` | gekozen groepstab | 4,8 / 8,8 op `segBg` |
| `onSegOn` | `#FFFFFF` | `#0F172A` | tekst gekozen groepstab | 5,9 / 10,7 |
| `field` | `#FFFFFF` | `#0F172A` | invoerveld | — |
| `fieldLine` | `#64748B` | `#64748B` | rand invoerveld | 4,8 / 3,8 |
| `danger` | `#DC2626` | `#F87171` | fout, verwijderen | 4,8 / 6,5 op `surface` |
| `success` | `#15803D` | `#4ADE80` | bevestiging | 5,0 / 10,2 op `surface` |
| `onGradient` | `#0F172A` | `#0F172A` | + en initialen op verloop | ≥ 6,4 |
| `gradStart` | `#A3E635` | `#A3E635` | verloop, 0% (lime-400) | — |
| `gradEnd` | `#0EA5E9` | `#0EA5E9` | verloop, 76–100% (sky-500) | — |
| `washStart` / `washEnd` | `#F7FEE7` / `#E0F2FE` | `#14240A` / `#082F49` | zachte tint achter Inloggen | — |

Verloop: 135° voor vlakken (avatar, +, icoon), 90° voor het streepje naast een jaartal.

Op foto's staat tekst nooit los. Er zijn twee vaste lagen, met wit erop:

| Laag | Waarde | Waarom |
|---|---|---|
| Coververloop | zwart 62% bovenaan, 55% op 100 pt, 0% onderaan | statusbalk en terugknop leesbaar (bevinding 7) |
| Pil op foto | `#0F172A` op 62%, blur 8 | wit erop haalt ≥ 5,0:1, ook op een witte foto |

## 3. Typografie

- **Systeemletter (SF Pro)** voor alles. Die schaalt het best mee met de iOS-tekstgrootte (Dynamic Type).
- **Literata 600** alleen voor jaartallen. Het lettertype zit in de build en laadt vóór het splashscreen verdwijnt, anders flitst eerst de systeemletter.
- Hoofdletters alleen aan het begin van een zin. Geen knoppen in hoofdletters.

Groottes in pt bij de standaard-tekststand. De basistekst is 18 in plaats van iOS 17, vanwege de 50+-doelgroep (invariant 11).

| Rol | pt | Gewicht |
|---|---|---|
| Grote titel (Mijn groepen, Inloggen) | 34 | 700 |
| Titel groep of album | 30 | 700 |
| Jaartal boven albums (Literata) | 38 | 600 |
| Jaartal boven albumtitel (Literata) | 22 | 600 |
| Kop leeg scherm | 22 | 700 |
| Groepsnaam | 21 | 600 |
| Basistekst, lijstrij, knop | 18 | 400 / 400 / 700 |
| Meta-regel, terug-pil | 16–17 | 400 / 600 |
| Albumnaam / albummeta | 17 / 15 | 600 / 400 |
| Veldlabel | 16 | 600 |
| "Nieuw"-label, badge | 14 | 700 |
| Tabbalk-label | 13 | 600 (actief 700) |

**Schalen.** Alle tekst schaalt mee met de iOS-tekstgrootte. Er is één uitzondering: tabbalk-labels groeien hoogstens 1,2×, tot 15,6 pt (bevinding 3). Bij de grootste standaardstand (xxxLarge, ongeveer ×1,35) gelden deze regels:

- Geen vaste hoogte rond tekst, alleen minimumhoogtes. Rijen groeien mee.
- Groepstabs gaan van één rij van vier naar twee rijen van twee zodra `fontScale ≥ 1,2`.
- De meta-regel breekt af. Acties ("Bewerk album") staan op een eigen regel, nooit naast lange tekst.
- Albumnamen gaan over meerdere regels. Ze worden nooit afgekapt tot één regel.
- De tabbalk groeit mee in hoogte.

De extra toegankelijkheidsstanden (AX1–AX5) vallen buiten invariant 4. De app krijgt daarvoor geen eigen layout en geen globale cap.

## 4. Maten

| Token | Waarde |
|---|---|
| Schermmarge | 16 |
| Afstanden | 4 · 8 · 12 · 16 · 22 · 28 |
| Aanraakvlak minimaal | 44 × 44 |
| Hoofdknop / invoerveld / lijstrij | 54 / 56 / 56 hoog |
| Kleine knop, groepstab | 44 hoog |
| Plusknop | Ø 58, steekt 26 boven de tabbalk uit |
| Tabbalk | 66 + onderste safe area, groeit mee |
| Afronding | knop 14, veld 12, kaart 14, lijstblok 12, albumtegel 12, groepsfoto 16, pil/label rond |
| Schaduw | alleen de + (0 4 14, zwart 26%) en de app-icoon-tegel |

## 5. Basiscomponenten en hun toestanden

| Component | Toestanden | Regels |
|---|---|---|
| Hoofdknop (`cta`) | normaal, ingedrukt, bezig, uit | Bezig: spinner en tekst ("Code versturen…"), niet opnieuw te tikken. Uit: alleen met uitleg erboven waarom. Eén hoofdknop per scherm. |
| Tweede knop | normaal, ingedrukt, uit | Rand en tekst in `primary`, 2 pt. Bv. "Opnieuw". |
| Tekstknop | normaal, ingedrukt | `ctaText` voor een actie (Nieuwe groep, Nieuw album), `primary` voor navigatie (Ik heb een uitnodiging). Min 44 pt hoog. |
| Kleine knop | normaal, ingedrukt | Rand `primary`, 44 pt hoog. Bv. "Bewerk album". |
| Invoerveld | leeg, gevuld, focus, fout, uit | Label altijd boven het veld. Focus: rand 2,5 pt in `primary`. Fout: rand in `danger` met de melding eronder. |
| Lijstrij | normaal, ingedrukt | Icoon links in `primary`, chevron rechts in `muted`. Gevaarlijke rij (Account verwijderen) in `danger`, in een eigen blok. |
| Groepstabs | gekozen, niet gekozen | Gekozen: `segOn`-pil met vette `onSegOn`-tekst. Twee rijen bij grote tekst. |
| Tabbalk | actief, inactief | Altijd icoon plus label. Actief: gevuld icoon op een `tabPill`-pil met vet label. Inactief: lijnicoon. |
| Plusknop | normaal, ingedrukt | Cirkel in het verloop met een `onGradient`-icoon. In licht een rand van 1,5 pt (`#0F172A` op 40%). |
| "Nieuw"-label | — | Tekst "nieuw" of "6 nieuw" op `cta`. Op een foto met een witte rand van 2 pt. Nooit alleen een stip. |
| Terugknop | normaal, ingedrukt | Zie §7. |
| Coverkop | met foto, zonder foto | Zonder foto: de wash-tint met een foto-icoon in `muted`. |
| Avatar | — | Verloop met initialen in `onGradient`. |
| Jaartal-kop | — | Literata in `primary`, met het verloopstreepje erachter. |
| Melding, laden, leeg | — | Zie §6. |

**Iconen: Ionicons** via `@expo/vector-icons` (besluit Wouter 2026-10-25). De oude app gebruikte ze ook, ze hebben een lijn- en een gevulde variant (inactief en actief), en ze werken ook in de webapp (Track B). Lijn voor gewone iconen, gevuld voor de actieve tab. Geen zelf getekende iconen, behalve het app-icoon.

**Ingevuld in stap 7** (niet in de mockups): kleine knop 16 pt vet, meta-regel 17 pt, "ingedrukt" = lagere dekking, Uitloggen op Home als tweede knop, laadtekst "Laden…".

## 6. Meldingen en toestanden (invariant 5)

Eén patroon, overal hetzelfde. Kleur is nooit het enige signaal: elke toestand heeft een icoon en tekst.

| Toestand | Vorm | Plaats |
|---|---|---|
| Laden | spinner in `primary` met tekst ("Albums laden…") | in het inhoudsgebied; de kop blijft staan |
| Bezig na een tik | spinner en tekst in de knop zelf | in de knop |
| Leeg | rond icoon op het verloop, kop, één zin uitleg, zichtbare hoofdknop | in het inhoudsgebied |
| Fout bij laden | foutmelding met de knop "Opnieuw" erin | in het inhoudsgebied |
| Fout na een actie | foutmelding | direct onder de knop die hem veroorzaakte |
| Bevestiging na een actie | bevestiging ("Code verstuurd") | direct onder de knop |
| Vóór iets onomkeerbaars | iOS-dialoog met "Annuleren" en een rode knop met het werkwoord ("Verwijderen") | — |

Een melding is een `surface`-vlak met een rand van 2 pt en een icoon van 26 pt in `danger` (fout) of `success` (bevestiging). Daarnaast staat een vette kop die zegt wat er gebeurde, met een tweede regel die zegt wat je kunt doen. De melding blijft staan tot de volgende actie: geen toast die vanzelf verdwijnt. VoiceOver leest hem voor zodra hij verschijnt. Geen emoji.

Hulp-modals uit de oude app komen niet terug (akkoord Wouter 2026-10-25). De uitleg zit in de lege schermen en in de labels.

## 7. Navigatie

**Uitgelogd:** tabbalk Inloggen · Uitnodiging (verhoogde cirkel) · Info.

**Ingelogd:** tabbalk Home · Mijn foto's · Toevoegen (+) · Profiel · Instellingen, zoals de oude app (invariant 1).

- **Home** opent de laatst bezochte groep (Albums), en anders Mijn groepen.
- **De +** opent "Foto's toevoegen" als modaal scherm, met een zichtbare knop "Sluiten". Het is een actie, geen tab met een eigen stack.
- **Elke tab heeft een eigen stack:** Mijn groepen → Groep (groepstabs Albums · Leden · Cover · Uitnodigen) → Album → Foto.

**Terugknop.** Elk scherm in een stack heeft een zichtbare terugknop met de naam van het vorige scherm ("‹ Mijn groepen"). Vegen vanaf de rand mag ook, maar is nooit de enige weg (invariant 11, bevinding 1).

- Gewone schermen: de iOS-navigatiebalk.
- Schermen met een cover: een zwevende pil linksboven, onder de statusbalk (§2), minstens 44 pt hoog.
- Modale schermen: "Sluiten" rechtsboven.

**Bibliotheek: Expo Router**, in de versie die bij de Expo SDK van de app hoort. Installeer met `npx expo install` en zet de versie vast (WP15). Redenen (invariant 10):

| Eis | Hoe Expo Router dat dekt |
|---|---|
| Deep links op `clubalmanac://` en de login-link van WP22 | Elk scherm is een route met een vaste URL. Een nieuwe link is een nieuw bestand, zonder aparte linking-config die uit de pas loopt. |
| Native terugknop en navigatiebalk | Stacks gebruiken de native stack van React Navigation, waar Expo Router op draait. |
| Eigen tabbalk (verhoogde +, labels met cap, pil) | Een eigen `tabBar`-component op de JS-tabs. |
| Schermen die bij wegnavigeren stoppen met luisteren | Zie hieronder. |
| Mee met Expo-upgrades | Het is de standaard van Expo, met versies gekoppeld aan de SDK. |

**Afgewogen en afgewezen:**
- **React Navigation los:** dezelfde motor, maar de deep links moeten met de hand worden bijgehouden.
- **Native tabs (UITabBar, met Liquid Glass):** geen middenknop als actie, en geen grip op hoe labels schalen.

**Subscription-discipline.** Een stack houdt onderliggende schermen gemount, en tabs ook. Vertrouw daarom niet op een unmount-optie van de navigator. WP15 laat live queries afhangen van focus: niet-gefocuste schermen krijgen `"skip"` (Convex), en de app pauzeert bij `AppState !== 'active'`.

**Overstap:** de app start nu via `index.ts` en `App.tsx`, zonder router. WP15 zet het entry-punt om, met de routes in `app/src/app/` (Expo Router ondersteunt `src/app`). Zo ontstaat geen verwarrende map `app/app/`. Daarbij blijven de WP13-schermen en hun tests werken (invariant 9).

## 8. App-icoon

Een polaroid met een eend erin, opgebouwd in lagen voor Liquid Glass (iOS 26). De bron is een Icon Composer-bestand met drie lagen. Uit dat bestand komen alle formaten en weergaven (invariant 7).

| Laag | Inhoud (viewBox 100) |
|---|---|
| Achtergrond | Verloop `gradStart` → `gradEnd`, van linksonder naar rechtsboven, sky vol vanaf 76% |
| Laag 1: kaartje | Wit, 94% dekking, −7° gedraaid. Rechthoek 19,14 · 62×74 · r6, met een uitgespaard venster 25,20 · 50×48 · r3. In licht een rand van 1 pt (`#0C4A6E` op 45%). |
| Laag 2: eend | Vlak silhouet (kop, snavel naar rechts, lijf met staartje), 15% kleiner dan het venster vult, minstens 8 eenheden van elke rand. In licht `#383A6A`, het donkerblauw van het oude icoon. In donker het verloop. |

| Weergave | Uiterlijk |
|---|---|
| Standaard | Wit kaartje en donkerblauwe eend op het verloop (eend 7,0–3,8:1 op het verloop) |
| Donker | Kaartje en eend in het verloop op `#020617` |
| Getint, helder | iOS maakt de kleuren; kaartje en eend blijven twee vormen |

- De SVG-bron staat in de mockups (`lgIcon`).
- Controleer in Icon Composer of de eend en het kaartje ook op 29 en 40 pt los van elkaar blijven.
- **Werkwijze (akkoord Wouter):** de B-sessie levert de lagen als losse SVG's plus een 1024×1024-PNG zonder transparantie als terugval in `app.json`. Wouter bouwt daarmee het `.icon`-bestand in Icon Composer en controleert 29 en 40 pt. Expo ondersteunt een `.icon`-bestand in `ios.icon` (SDK 54+); B verifieert dat voor deze SDK en zet de verwijzing klaar.
- De klassieke Polaroid-rand (onderaan breder) is merkrechtelijk beschermd. Voor een besloten app is dat geen probleem. Bij een publieke release: maak de rand rondom even breed.

## 9. Patronen voor schermen zonder mockup

Deze schermen zijn niet getoetst in stap 5. Feature-WP's volgen deze regels en laten nieuwe patronen eerst in de tokens of in dit doc vastleggen.

| Scherm | Regel |
|---|---|
| Foto groot | Zichtbare knoppen "Vorige" en "Volgende" naast het vegen. "Sluiten" rechtsboven. Acties (delen, melden, verwijderen) als knoppen met label, niet alleen via lang drukken. |
| Foto's toevoegen | Modaal scherm. Voortgang per foto in tekst ("3 van 12 geüpload"). Bij een fout: melding onder de knop, met "Opnieuw". |
| Mijn foto's | Hetzelfde raster als een album, met "nieuw"-labels en "Jouw foto"-markering. |
| Instellingen, Leden | Gegroepeerde lijst zoals Profiel. Leden met de avatar links. |
| Cover kiezen | Kiezen uit het raster, met een zichtbare knop "Opslaan" en een bevestiging onder die knop. |
| Uitnodigen | Veld en hoofdknop. Bevestiging of fout direct onder de knop. |
| Selecteren in een raster | Een vinkje op de foto plus de teller "3 geselecteerd". Acties in een balk onderaan, met tekst. |
| iPad, liggend | Geen eigen layout. De tabbalk blijft. Rasters krijgen meer kolommen (tegel ongeveer 120 pt). Tekstkolommen hoogstens 640 pt breed, gecentreerd. |
| VoiceOver | Elke icoonknop krijgt een label. Een badge leest als tekst ("6 nieuw"). Een foto leest als "Foto 3 van 48", met "nieuw" of "jouw foto" erbij. De pil-terugknop leest als "Terug naar Mijn groepen". |

## 10. Bevindingen toegankelijkheidscheck (stap 5)

| Nr | Bevinding | Verwerkt |
|---|---|---|
| 1 | Geen terugknop bij Groep → Albums | Pil "‹ Mijn groepen" op de cover (§7) |
| 2 | Toestanden ontbreken | Laden, leeg, fout en bevestiging in licht en donker (§6). "Nieuw album" staat op een eigen regel, dus ook in een lege groep. |
| 3 | Overloop bij xxxLarge | Tabbalk-labels hoogstens ×1,2, bredere kolommen voor "Mijn foto's", "Toevoegen" en "Instellingen", tabbalk groeit mee. Groepstabs naar 2×2. Meta-regel breekt af. "Bewerk album" op een eigen regel (§3). Large Content Viewer: niet verwerkt, zie onder. |
| 4 | Aanraakvlakken onder 44 pt | Groepstabs en "Bewerk album" 44 pt (§4) |
| 5 | Actieve tab alleen herkenbaar aan tint | Gevuld icoon op een pil, met vet label (§5) |
| 6 | Gekozen groepstab valt weg | Gevulde blauwe pil met vette tekst, 4,8 / 8,8:1 tegen de balk |
| 7 | Statusbalk en terugknop op de cover | Coververloop 62% / 55% bovenaan (§2) |
| 8 | Icoon op klein formaat | Eend kleiner en vrij in het venster, donkerblauw in licht, rand om het kaartje. De check op 29 en 40 pt in Icon Composer volgt in stap 7. |
| 9 | Oranje tekstknop met weinig marge | `ctaText` oranje-800 in licht: 6,7:1 |
| 10 | "Nieuw"-stip te klein | Label met tekst "nieuw" |
| 11 | Halo bij bijna-wit op bijna-zwart | Donkere tekst `#E2E8F0` (16,4:1) |
| 12 | Rand van de + te zwak in licht | Rand van 1,5 pt en een sterkere schaduw |
| 13 | Lange albumnaam, inloggen met toetsenbord | Albumnamen over meerdere regels. Inloggen scrolt en ontwijkt het toetsenbord; de knop blijft boven het toetsenbord zichtbaar. |

**Niet volledig verwerkt.**
- Large Content Viewer (bevinding 3) zit niet in React Native zelf. In de plaats daarvan: de cap op ×1,2 en de bredere kolommen, en volgens de schatting passen alle labels daarmee. Komt er een bibliotheek voor, dan kan WP15 hem alsnog toevoegen.
- De schattingen bij xxxLarge komen uit de mockups. Het echte bewijs is gate-stap 3 op de iPhone.
