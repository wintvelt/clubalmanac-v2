# Prompt discipline (A en B)

Geef B niet expliciet pseudo-code of code-skeletten in instructie-prompts. B's spec is: tests + plan-doc + hoge-niveau guidance. B kiest zelf hoe te implementeren.

## Hoe toepassen

Bij B-prompts:
- Specifieke beslissingen vermelden ("granulaire try/catch met console.error per stage", "HEIC detectie via magic bytes", "lang=en in URL") zonder concrete implementatie uitschrijven
- Hoge-niveau guidance: wat moet er, niet hoe
- Tests + plan-doc zijn de spec
- B kiest API-keuzes, error handling, parsing strategy zelf

Voor A-prompts is wat meer concreetheid acceptabel (tests zijn structureel) maar ook daar geen hele test-bodies pre-schrijven.

## Waarom

Audit-13 (cyclus 2 EXIF/Photon) bevestigde dat substantiële pseudo-code in B-prompt drie-niveau bias creëert: tests + code + pseudo-code delen blind spots. B nam variabele-namen, comment-style en edge-case scope 1:1 over zonder eigen judgement, miste edge cases die hij wel had moeten zien.

A→B onafhankelijkheid is cruciaal voor de audit-discipline. Als A en B beide aan dezelfde mentale spec werken (geleverd door dezelfde prompt-author), wordt audit minder effectief.
