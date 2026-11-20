// WP35 A-invariant W7: `Alert.alert` doet op het web niets (react-native-web),
// dus een bevestiging zou blijven hangen. Hier de vraag van de browser: OK gaat
// door, Annuleren stopt. Nooit hangen.
export type Confirmation = { title: string; message: string; button: string; destructive: boolean };

export function askConfirmation(c: Confirmation): Promise<boolean> {
  const text = [c.title, c.message].filter((s) => s !== "").join("\n\n");
  try {
    return Promise.resolve(window.confirm(text));
  } catch {
    return Promise.resolve(false);
  }
}
