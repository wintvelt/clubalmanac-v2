// WP17d — draagt een beeld GPS? Zie tests/_helpers/jpeg.ts.
//
// Fix-cyclus 1 (audit S2): `exifGps` keek alleen naar de segmenten tot de
// beelddata, en zag daardoor een tweede beeld of een trailer met GPS niet.
// Hij zoekt nu in het hele bestand.

export { exifGps, GPS_JPEG } from "../_helpers/jpeg";
