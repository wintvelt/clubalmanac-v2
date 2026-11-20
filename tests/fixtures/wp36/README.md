# WP36-testfoto's

Synthetisch, zonder persoonsgegevens, gemaakt met sharp 0.35 via [`scripts/wp36/maak-testfotos.mjs`](../../../scripts/wp36/maak-testfotos.mjs). De plaatsen zijn verzonnen.

De JPEG's zijn 1200×900 in de ruwe pixels: blauw met een rood vlak van 240×180 linksboven. De EXIF-stand bepaalt hoe een viewer ze rechtop toont.

| Bestand | Stand | Rechtop | Rood vlak rechtop | Datum (EXIF) | Plaats (EXIF) |
|---|---|---|---|---|---|
| `staand-6.jpg` | 6 | 900×1200, staand | rechtsboven | DateTimeOriginal 2024:07:14 15:30:00 | 52,0907 N, 5,1214 O |
| `omgekeerd-3.jpg` | 3 | 1200×900, liggend | rechtsonder | DateTimeOriginal 2023:12:31 23:59:59 | 22,9519 Z, 43,2105 W |
| `staand-8.jpg` | 8 | 900×1200, staand | linksonder | alleen CreateDate 2022:05:01 08:00:00 | geen |
| `nul-gps.jpg` | 1 | 1200×900 | linksboven | DateTimeOriginal 2025:01:02 03:04:05 | 0/0 (zoals de fotokiezer van Android de plaats weghaalt) |
| `zonder-exif.jpg` | geen | 1200×900 | linksboven | geen | geen |
| `doorzichtig.png` | — | 400×300 | rood vlak 200×150 linksboven, de rest doorzichtig | — | — |

Gebruik in de gate: in de browser (laptop) of op de Android-emulator kiezen en uploaden; daarna in de app en op het web: rechtop zoals in de tabel, de datum en de plaats zoals in de tabel, `nul-gps` en `staand-8` zonder plaats, `zonder-exif` zonder datum (niet "vandaag"), en `doorzichtig.png` met een witte achtergrond.
