import { Pressable, Text } from "react-native";
import { ui } from "../ui";

type Props = { title: string; onPress: () => void; disabled?: boolean };

export function LinkButton({ title, onPress, disabled = false }: Props) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
      <Text style={[ui.link, disabled && ui.buttonDisabled]}>{title}</Text>
    </Pressable>
  );
}
