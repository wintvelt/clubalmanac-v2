// WP15a F20: "Opnieuw wissen" na een mislukte wis mag geen lopende login
// raken. Een login doet resume() vóór zijn eerste verzoek; een wis daarna
// wist het client-token van die poging. Dus alleen in de e-mailstap, en
// alleen als er geen verzoek loopt. Melding en knop staan er samen.
export function wipeRetryShown(input: {
  wipeFailed: boolean;
  step: "email" | "code";
  busy: boolean;
}): boolean {
  return input.wipeFailed && input.step === "email" && !input.busy;
}
