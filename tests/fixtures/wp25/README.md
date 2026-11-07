# WP25 HEIC-fixtures

Synthetisch, zonder persoonsgegevens. Gemaakt op macOS 27.2 met de encoder van Apple (ImageIO via `sips`), dezelfde familie als de iPhone-camera:

1. Een JPEG van 1200×900: blauw, met een rood vlak van 240×180 linksboven in de ruwe pixels. EXIF-oriëntatie 3, 6 of 8 (sharp `withMetadata({ orientation })`).
2. `sips -s format heic g<n>.jpg --out g<n>.heic`

Elk bestand heeft tegels (`grid`), een `irot` (3 → hoek 2, 6 → hoek 3, 8 → hoek 1) én de EXIF-tag. Zie WP25 §Spec-criticus, kernvondst 1.

Bedoelde stand (zoals een viewer de JPEG met de tag toont):

| Bestand | Afmeting rechtop | Rood vlak |
|---|---|---|
| `g3.heic` | 1200×900, liggend | rechtsonder |
| `g6.heic` | 900×1200, staand | rechtsboven |
| `g8.heic` | 900×1200, staand | linksonder |

`groot-17mp.heic` (fix-cyclus 1, A-invariant 20): 4800×3600 = 17,3 MP, net boven de HEIC-grens van 16 MP. Een vlak blauw beeld met een rood vlak linksboven, als JPEG gemaakt met sharp en daarna `sips -s format heic`. 10 kB, zonder EXIF-tag. De test decodeert hem nooit: hij pint dat de grens uit de kop gelezen wordt.
