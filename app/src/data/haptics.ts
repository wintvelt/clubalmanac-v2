// WP33 invariant 10: een lichte tik op het toestel, precies wanneer de groene
// melding of de bestemming verschijnt. Nooit bij een fout. De app wacht er
// niet op, en een toestel zonder haptics (iPad, simulator) of met trillen uit
// in iOS geeft niets, ook geen fout (E1).
//
// De native module laadt pas bij de eerste tik: de schermen die dit importeren
// blijven zo los te laden zonder React Native (de unit-tests).
export function successTap(): void {
  import("expo-haptics")
    .then(({ impactAsync, ImpactFeedbackStyle }) => impactAsync(ImpactFeedbackStyle.Light))
    .catch(() => {});
}
