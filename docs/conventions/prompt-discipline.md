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

## Intent over delta

Bij fix-cycli of mini-revisies aan A of B: prompts beschrijven het *wat* en *waarom*, niet het *hoe*. Geen regelnummers, geen voorgestelde fix-vormen, geen API-keuzes, geen pseudo-code. De rol bezit zijn eigen oplossingsruimte; regie die voorinvult ondergraaft die autonomie en maakt audit minder zinnig (auditor reviewt dan effectief regie's keuze, niet de rol-output).

Verkeerd (regie doet A's denkwerk):
> Lees tests/photos/rotate.test.ts regel 257. Onder noUncheckedIndexedAccess faalt ROT90[FLIP[start]] (FLIP[start] is number|undefined). Fix met non-null-assertion of door FLIP als Record<1..8, number> te typeren.

Goed (intent-only):
> typecheck faalt op `tests/photos/rotate.test.ts` onder `noUncheckedIndexedAccess`. Fix de type-gap, geen logica-edits. Commit + rapporteer.

Geboren uit WP8 type-fix-prompt (regie specificeerde regel + twee fix-vormen, gaf A's vakgebied weg).
