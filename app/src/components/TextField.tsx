import { useContext, useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { border, radius, size, space, typography, useTheme } from "../theme";
import { Text } from "./Text";
import { KeyboardRevealContext } from "./useKeyboardReveal";

type Props = Omit<TextInputProps, "style"> & {
  // Altijd zichtbaar boven het veld, ook als het gevuld is.
  label: string;
  // Fout: rand in `danger`. De melding zelf staat eronder, als <Notice>.
  invalid?: boolean;
  // Voor een veld met meerdere regels (WP20: omschrijving).
  minHeight?: number;
};

export function TextField({ label, invalid = false, editable = true, minHeight, onFocus, onBlur, ...rest }: Props) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  // WP32 invariant 11: het scherm schuift het veld boven het toetsenbord.
  const reveal = useContext(KeyboardRevealContext);
  const borderColor = invalid ? colors.danger : focused ? colors.primary : colors.fieldLine;
  return (
    <View style={styles.wrap}>
      <Text variant="fieldLabel">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        onFocus={(e) => {
          setFocused(true);
          reveal?.();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        keyboardAppearance={scheme}
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.field,
            borderColor,
            borderWidth: focused || invalid ? border.fieldFocus : border.field,
          },
          !editable && styles.disabled,
          minHeight !== undefined && { minHeight, textAlignVertical: "top" },
        ]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s - 2 },
  input: {
    minHeight: size.field,
    borderRadius: radius.field,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    fontSize: typography.body.fontSize,
  },
  disabled: { opacity: 0.6 },
});
