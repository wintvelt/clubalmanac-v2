import { StyleSheet } from "react-native";

// Minimale opmaak. Thema en design volgen na WP14.
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: "600" },
  text: { fontSize: 16, lineHeight: 22 },
  muted: { fontSize: 14, color: "#666" },
  error: { fontSize: 15, color: "#b00020" },
  info: { fontSize: 15, color: "#1b5e20" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
  },
  button: {
    backgroundColor: "#222",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  link: { color: "#1565c0", fontSize: 16, paddingVertical: 6 },
});
