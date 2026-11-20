// WP36: de testfoto's in tests/fixtures/wp36/ (app-tests en de gate).
// Synthetisch, zonder persoonsgegevens; de plaatsen zijn verzonnen.
// Gebruik (in de root, sharp staat in package.json):
//   node scripts/wp36/maak-testfotos.mjs tests/fixtures/wp36
// Zie tests/fixtures/wp36/README.md voor wat elk bestand is.
import sharp from "sharp";
const out = process.argv[2];
const W = 1200, H = 900;
async function base() {
  const red = await sharp({ create: { width: 240, height: 180, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 30, g: 80, b: 200 } } })
    .composite([{ input: red, left: 0, top: 0 }]);
}
const dms = (deg) => { const a = Math.abs(deg); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = Math.round(((a - d) * 60 - m) * 60 * 100); return `${d}/1 ${m}/1 ${s}/100`; };
async function jpg(name, { orientation = "1", ifd2 = {}, gps = null }) {
  const exif = { IFD0: { Orientation: orientation } };
  if (Object.keys(ifd2).length) exif.IFD2 = ifd2;
  if (gps) exif.IFD3 = { GPSLatitudeRef: gps[0] < 0 ? "S" : "N", GPSLatitude: dms(gps[0]), GPSLongitudeRef: gps[1] < 0 ? "W" : "E", GPSLongitude: dms(gps[1]) };
  await (await base()).jpeg({ quality: 80 }).withExif(exif).withMetadata({ orientation: Number(orientation) }).toFile(`${out}/${name}`);
}
await jpg("staand-6.jpg", { orientation: "6", ifd2: { DateTimeOriginal: "2024:07:14 15:30:00" }, gps: [52.0907, 5.1214] });
await jpg("omgekeerd-3.jpg", { orientation: "3", ifd2: { DateTimeOriginal: "2023:12:31 23:59:59" }, gps: [-22.9519, -43.2105] });
await jpg("staand-8.jpg", { orientation: "8", ifd2: { DateTimeDigitized: "2022:05:01 08:00:00" } });
await jpg("nul-gps.jpg", { ifd2: { DateTimeOriginal: "2025:01:02 03:04:05" }, gps: [0, 0] });
await (await base()).jpeg({ quality: 80 }).toFile(`${out}/zonder-exif.jpg`);
await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } } }).png().toBuffer(), left: 0, top: 0 }])
  .png().toFile(`${out}/doorzichtig.png`);
