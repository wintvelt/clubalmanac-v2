import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ui } from "../ui";

type Props = {
  title?: string;
  message?: string;
  spinner?: boolean;
  children?: ReactNode;
};

export function StatusScreen({ title, message, spinner = false, children }: Props) {
  return (
    <SafeAreaView style={ui.screen}>
      <View style={ui.centered}>
        {title && <Text style={ui.title}>{title}</Text>}
        {message && <Text style={ui.text}>{message}</Text>}
        {spinner && <ActivityIndicator />}
        {children}
      </View>
    </SafeAreaView>
  );
}
