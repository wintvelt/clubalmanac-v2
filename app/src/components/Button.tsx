import { ActivityIndicator, Pressable, Text } from "react-native";
import { ui } from "../ui";

type Props = {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, busy = false, disabled = false }: Props) {
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={[ui.button, inactive && ui.buttonDisabled]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>{title}</Text>}
    </Pressable>
  );
}
