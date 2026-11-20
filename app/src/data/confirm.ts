import { Alert } from "react-native";

// Een bevestiging met Annuleren en één knop. `true` alleen bij die knop; wegtikken
// telt als Annuleren. De web-variant staat in confirm.web.ts (WP35 W7).
export type Confirmation = { title: string; message: string; button: string; destructive: boolean };

export function askConfirmation(c: Confirmation): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      c.title,
      c.message,
      [
        { text: "Annuleren", style: "cancel", onPress: () => resolve(false) },
        { text: c.button, style: c.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
