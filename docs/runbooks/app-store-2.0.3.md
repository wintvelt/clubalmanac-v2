# App Store Connect: versie 2.0.3

Alleen wat verandert ten opzichte van [2.0.2](./app-store-2.0.2.md). Inhoud: foto-detail schermvullend (WP46, met de Android-fixes), versielabel in Info (WP47), neutrale teksten en nieuwe meldingen bij een te lang filmpje (WP42). Naam en ondertitel kun je alleen wijzigen terwijl de nieuwe versie in *Prepare for Submission* staat.

## Stap 1: nieuwe versie aanmaken

Distribution → links naast **iOS App** het **+**-teken → versie `2.0.3`.

## Stap 2: ondertitel (General → App Information, per taal)

| | Nederlands | English (U.S.) |
|---|---|---|
| **Subtitle** (max. 30) | `Alle clubherinneringen` | `All your club memories` |

## Stap 3: What's New (iOS App → 2.0.3, per taal)

**Nederlands**

```
- Foto's schermvullend: tik op een foto voor alle ruimte, of draai je telefoon.
- Bij Info staat nu ook het buildnummer.
- Kleine verbeteringen en duidelijkere teksten.
```

**English (U.S.)**

```
- Full-screen photos: tap a photo for all the space, or turn your phone.
- Info now also shows the build number.
- Small improvements and clearer texts.
```

Promotional Text, Description en Keywords blijven zoals bij 2.0.2.

## Stap 4: testen en indienen

Test de production-build uit TestFlight met [`release-checks.md`](./release-checks.md). Dan *Build*: de nieuwe build kiezen → *Manually release this version* → **Add for Review**. Na goedkeuring **Release This Version**, en daarna de blokken in `release-checks.md` weghalen.
