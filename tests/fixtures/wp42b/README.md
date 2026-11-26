# Testfilmpjes WP42b (Android)

Gemaakt door A op 2026-11-26 op de emulator `clubalmanac-api35` (Android 15, tijdzone Europe/Amsterdam) met een eigen meetapp (`MeetActivity.java`, niet de app; Media3 1.9.1, dezelfde versie als `expo-video` 58.0.14). Invoer: de testfilmpjes van WP37 (`tests/fixtures/wp37`) en twee van 3 minuten uit `mklang.swift` (30 fps, 108 × 192, AAC 44,1 kHz). Geen echte opnames, geen echte plaats.

De meetapp doet drie dingen:
- **"Android-originelen"**: `plain.mp4` opnieuw verpakt met `MediaMuxer` en `setLocation` (dezelfde schrijver als de camera, MPEG4Writer), zodat datum en plaats in de vorm van Android in het bestand staan.
- **Verkleinen met Media3 Transformer** (H.264, 3,6 Mbit/s, AAC 128 kbit/s, hooguit 30 fps), in twee vormen: met de standaardmuxer (`InAppMp4Muxer`, die de metadata van het origineel overneemt) en met alle metadata weg.
- **Lezen** met `MediaMetadataRetriever` (datum, plaats, duur, draaiing), naar logcat.

| Bestand | Wat | Backend (`videoProblem`) |
|---|---|---|
| `android-muxer-plaats.mp4` | MediaMuxer, plaats 52.3676/4.9041; Android leest `+52.3676+004.9041/`, datum `20261126T174453.000Z` (UTC; de klok van de emulator stond op 18:44 CET) | `locatie` |
| `android-muxer-zuid-oost.mp4` | idem, −33.8688/151.2093: `-33.8688+151.2093/` | `locatie` |
| `android-muxer-noord-west.mp4` | idem, 40.7128/−74.0060: `+40.7128-074.0060/` | `locatie` |
| `android-muxer-staand.mp4` | idem, met draaiing 90 | `locatie` |
| `datum-nul.mp4` | `plain.mp4` met de maaktijd in `mvhd` op 0; Android leest `19040101T000000.000Z` | — |
| `media3-schoon.mp4` | Transformer uit `android-muxer-plaats.mp4`, metadata weg; `ftyp`, `moov`, `free` (gereserveerd), `mdat`; beeld liggend gecodeerd met draai-matrix 90 | `null` |
| `media3-met-plaats.mp4` | Transformer met de standaardmuxer: neemt de plaats over als `©xyz` `+52.3676+4.9041/` | `locatie` |
| `media3-zonder-geluid.mp4` | Transformer uit `wp37/noaudio.mp4`, metadata weg | `null` |
| `media3-180s-begin.bin` | de eerste 512 KiB van een verkleind filmpje van 3:00,349 (`mklang.swift`): index vooraan (131 KB), duur volgens de backend 180 280 ms | `null` (grootte 6 473 153) |
| `android-muxer-180s-begin.bin` | de eerste 512 KiB van een origineel van 3 minuten van MediaMuxer: de index staat achteraan | `index_achteraan` |

Opnieuw maken: een Android-project met `media3-transformer`, `media3-effect` en `media3-common` 1.9.1 en `MeetActivity.java`; invoer met `adb push` naar `/data/local/tmp` en met `run-as` naar `files/in` van de meetapp; uitvoer met `adb exec-out run-as … cat files/out/…`. De meetapp staat niet in de repo als project (gitignored `builds/wp42b-meet`).
