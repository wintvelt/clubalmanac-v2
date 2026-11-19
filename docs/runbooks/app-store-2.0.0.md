# App Store Connect: versie 2.0.0

Wat er in App Store Connect staat voor 2.0.0, per veld. Klaargezet en ingediend 2026-11-19 (22:38); build 70 is gekoppeld. **Indienen** (*Add for Review*) pas op T0.8 van het [draaiboek](./wp31-cutover-draaiboek.md), als prod gevuld is en de demo-groep bestaat.

## Versie 2.0.0 (Distribution → iOS App → 2.0.0)

**Promotional Text** (max. 170 tekens)

```
Een compleet vernieuwde app. Al je groepen, albums en foto's staan er weer in. Inloggen doe je met je e-mailadres en een code per mail.
```

**Description**

```
Clubalmanac is het fotoalbum van je club. Je deelt foto's in een besloten groep, alleen met de mensen die zijn uitgenodigd.

Groepen en albums
Elke groep heeft albums, per jaar gesorteerd. Je ziet meteen in welk album nieuwe foto's staan.

Foto's delen
Zet foto's uit je fotobibliotheek in een album, met datum en plaats. Bekijk ze schermvullend, draai ze, of deel ze via het deelmenu. Op de kaart van een album zie je waar de foto's zijn gemaakt. Onder Mijn foto's staat alles wat je zelf hebt gedeeld.

Alleen op uitnodiging
Een beheerder van de groep nodigt je uit per mail. Je logt in met je e-mailadres en een code, zonder wachtwoord. Wat je deelt, zien alleen de leden van je groepen.

Melden en meedenken
Hoort een foto er niet in, meld hem dan. Ideeën en problemen geef je door in de app.

Geen advertenties en geen tracking. Je account en al je gegevens verwijder je zelf, op Profiel.
```

**Keywords** (max. 100 tekens)

```
fotoalbum,club,vereniging,groep,foto's delen,album,besloten,vrienden,familie,herinneringen
```

**Support URL:** `https://clubalmanac.com` · **Marketing URL:** leeg

**What's New in This Version**

```
Clubalmanac is helemaal opnieuw gebouwd.
- Inloggen met je e-mailadres en een code per mail, zonder wachtwoord.
- Al je groepen, albums en foto's staan er weer in.
- Mijn foto's: alles wat je zelf hebt gedeeld, op één plek.
- Een kaart per album, en foto's delen via het deelmenu.
- Licht en donker, zoals je iPhone staat.
- Je account verwijderen kan in de app, op Profiel.
```

De app heeft ook een **English (U.S.)**-lokalisatie; daar is *What's New* verplicht (taalmenu rechtsboven):

```
Clubalmanac has been completely rebuilt.
- Sign in with your email address and a code by email, no password.
- All your groups, albums and photos are back.
- My photos: everything you shared, in one place.
- A map per album, and share photos via the share sheet.
- Light and dark mode, following your iPhone.
- Delete your account in the app, under Profile.
```

**Copyright:** `2026 Vaatje`

**Build:** 70. **Version Release:** *Manually release this version*. **Phased Release:** uit (W10).

### App Review Information

- *Sign-in required*: aan.
- *User name*: `wouter.intvelt+clerk_test@gmail.com` (het demo-account van T0.7).
- *Password*: `424242` (dat is de inlogcode; een wachtwoord is er niet).
- *Contact Information*: je eigen naam, telefoon en mailadres.
- *Notes*:

```
Clubalmanac is a private photo-sharing app for one small club (about 20 members). Groups are invitation-only: a group admin invites someone by email, and only invited people can create an account. The app is in Dutch.

Sign-in: enter the email address from the sign-in information, tap "Stuur code", then enter the code 424242. This is a test account (test mode of our auth provider Clerk), so no email is sent. There is no password.

The demo account is a regular member of the group "Demo", which has a few sample photos.

- Account deletion: tab Profiel → "Account verwijderen", then type "verwijder" to confirm.
- Reporting content: open a photo, tap the menu → "Melden". The webmaster reviews reports in the app and removes content.
- Abusive members: a group admin removes a member via the group's members list → "Uit de groep halen".
- Feedback and problems: tab Instellingen → "Ideeën" and "Probleem melden".
```

## App Privacy (Trust & Safety → App Privacy)

*Do you or your third-party partners collect data from this app?* **Yes.** Per gegevenstype: doel **App Functionality**, **gekoppeld aan de gebruiker**, **niet voor tracking**.

| Categorie | Type | Wat het is |
|---|---|---|
| Contact Info | Name | naam in Profiel |
| Contact Info | Email Address | inloggen, uitnodigingen |
| User Content | Photos or Videos | gedeelde foto's |
| User Content | Customer Support | probleemmeldingen |
| User Content | Other User Content | namen van groepen en albums, ideeën |
| Location | Precise Location | GPS uit de foto (alleen zichtbaar voor groepsleden) |
| Identifiers | User ID | account-ID |
| Usage Data | Product Interaction | laatste bezoek per groep en album, voor de tellers van nieuwe foto's |

Geen Diagnostics: de app heeft geen crash- of analysetool. Ook geen *Product Personalization* of *Analytics* als doel; de opgave van 1.6.0 had die wel (en *Other Diagnostic Data*). App Privacy geldt voor de app, niet per versie: na *Publish* staat het meteen op de productpagina.

## Leeftijdsclassificatie (App Information → Age Rating)

Overal **None** of **No**, behalve *User-Generated Content*: **Yes**. Geen berichten of chat, geen advertenties, geen onbeperkt internet, geen gokken, geen ouderlijk toezicht. De leeftijd rekent Apple daaruit zelf uit.

## Screenshots

Gemaakt 2026-11-19 met dev-data (Dev Wouter), in de gitignorede map `builds/appstore/`: zeven voor de iPhone (1206 × 2622), zes voor de iPad 13 inch (2064 × 2752), en voor de iPhone Duo drie van het buitenscherm (1398 × 2034) en vijf van het binnenscherm (2007 × 2853, staand). Het groepsscherm zit niet in de iPad-set, omdat de albumlijst daar een ongeschikte albumnaam laat zien. Op de Duo vallen schermen met een fotoraster (buiten) of de groepskop (binnen) af door de clock-strip-bug. Vermijd verder testgroepen, de blauwe testtegel en foto's met "Dev …" als eigenaar.
