import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { border, radius, size, space, typography, useTheme } from "../theme";
import { Text } from "./Text";

type Props = Omit<TextInputProps, "style"> & {
  // Altijd zichtbaar boven het veld, ook als het gevuld is.
  label: string;
  // Fout: rand in `danger`. De melding zelf staat eronder, als <Notice>.
  invalid?: boolean;
};

export function TextField({ label, invalid = false, editable = true, onFocus, onBlur, ...rest }: Props) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
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
