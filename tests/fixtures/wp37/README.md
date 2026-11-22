# Testfilmpjes WP37

Gemaakt op de server (macOS, AVFoundation) met `mkfix.swift` in deze map, op 2026-11-21. Elk ~2 s, 108 × 192, 10 fps, beeld van een verloop, geluid een toon van 440 Hz. Geen echte opnames, geen personen, geen echte plaats (de locatie is het centrum van Amsterdam).

```bash
swiftc -O -o /tmp/mkfix tests/fixtures/wp37/mkfix.swift
/tmp/mkfix <uit> <mp4|mov> <avc1|hvc1> <seconden> <faststart 0|1> <geluid 0|1> <none|mdta|udta|both|date>
```

| Bestand | Aanroep | Wat erin zit |
|---|---|---|
| `plain.mp4` | `mp4 avc1 2 1 1 none` | merk `mp42`, H.264, AAC, index vooraan, geen metadata |
| `noaudio.mp4` | `mp4 avc1 2 1 0 none` | zonder geluidsspoor |
| `moov-at-end.mp4` | `mp4 avc1 2 0 1 none` | index (`moov`) ná de beelddata |
| `hevc.mp4` | `mp4 hvc1 2 1 1 none` | HEVC (`hvc1`) |
| `location-loci.mp4` | `mp4 avc1 2 1 1 udta` | locatie; AVFoundation schrijft hem in mp4 als binair `udta/loci` |
| `location-loci-date.mp4` | `mp4 avc1 2 1 1 mdta` | locatie (`loci`) en datum (`udta/date`) |
| `date-only.mp4` | `mp4 avc1 2 1 1 date` | alleen een datum (`udta/date`), geen locatie |
| `iphone-like.mov` | `mov avc1 2 1 1 both` | QuickTime (`qt  `) met `udta/©xyz` en `meta/keys` `com.apple.quicktime.location.ISO6709`, `…creationdate`, `…make`, zoals een iPhone-opname |

De locatie-vormen zijn met een blok-lezer nagekeken (welk blok waar staat). Randgevallen die AVFoundation niet maakt (lange duur, 64-bit `mvhd`, metadata-spoor, locatie op spoor-niveau) bouwen de tests zelf: `tests/videos/_boxes.ts`.

Wouters voorbeeld (`builds/video/daatfilmpje.mp4`) staat niet in de repo; `tests/videos/mp4.test.ts` toetst het alleen als het lokaal aanwezig is.
