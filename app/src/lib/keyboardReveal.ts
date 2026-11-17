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
