// WP32 invariant 11, C1, C2 en C5: waar een scherm met het toetsenbord open
// naartoe scrolt. Alles in pt, in de coördinaten van de inhoud van de
// ScrollView. `visibleHeight`: het deel van de ScrollView boven het
// toetsenbord. `maxOffset`: de offset waarbij het einde van de inhoud net
// boven het toetsenbord staat.
//
// 1. Het veld waarin getypt wordt staat in beeld; bij een meerregelig veld dat
//    hoger is dan wat er past, de onderkant (daar staat de cursor bij typen).
// 2. Past alles van het veld tot het einde (de knop, een fout na versturen),
//    dan staat dat er allemaal. Past het niet (een lang formulier), dan
//    schuift het scherm zo weinig mogelijk: de knop is te bereiken door te
//    scrollen.
export function revealOffset(input: {
  fieldTop: number;
  fieldBottom: number;
  visibleHeight: number;
  maxOffset: number;
  margin: number;
  current: number;
}): number {
  const { fieldTop, fieldBottom, visibleHeight, margin, current } = input;
  const maxOffset = Math.max(0, input.maxOffset);
  const keepTop = fieldTop - margin;
  const keepBottom = fieldBottom + margin - visibleHeight;
  const offset =
    maxOffset <= keepTop
      ? Math.max(keepBottom, maxOffset)
      : Math.min(Math.max(current, keepBottom), Math.max(keepTop, keepBottom));
  return Math.max(0, Math.min(offset, maxOffset));
}

// WP32 C5 (besluit 4): waar het scherm naartoe scrolt als de inhoud van maat
// verandert terwijl het toetsenbord open is (een melding verschijnt, een
// meerregelig veld groeit). Het scherm springt niet terug naar het veld:
// - Stond het einde in beeld (de user tikte op de knop), dan blijft het einde
//   in beeld, met de melding die net verscheen. Zo ver als het veld bovenin
//   in beeld blijft, als het veld in beeld was.
// - Anders blijft het scherm staan.
// - Was het veld in beeld, dan blijft zijn onderkant (de cursor) in beeld:
//   alleen dan schuift het scherm mee, zo weinig mogelijk.
// `field*` en `maxOffset` na de maatwijziging; `wasAtEnd` en `fieldWasInView`
// ervoor.
export function resizeOffset(input: {
  fieldTop: number;
  fieldBottom: number;
  visibleHeight: number;
  maxOffset: number;
  margin: number;
  current: number;
  wasAtEnd: boolean;
  fieldWasInView: boolean;
}): number {
  const { fieldTop, fieldBottom, visibleHeight, margin, current, wasAtEnd, fieldWasInView } = input;
  const maxOffset = Math.max(0, input.maxOffset);
  let offset = wasAtEnd ? maxOffset : current;
  if (fieldWasInView) {
    const keepTop = fieldTop - margin;
    const keepBottom = fieldBottom + margin - visibleHeight;
    offset = Math.min(offset, Math.max(current, keepTop, keepBottom));
    offset = Math.max(offset, keepBottom);
  }
  return Math.max(0, Math.min(offset, maxOffset));
}
