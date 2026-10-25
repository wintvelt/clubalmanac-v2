import { Text } from "react-native";
import type { Doc } from "../../../convex/_generated/dataModel";
import { SignOutButton } from "../auth/SignOutButton";
import { ui } from "../ui";
import { StatusScreen } from "./StatusScreen";

// Eén scherm achter de login: wie ben ik volgens Convex (users.current).
export function HomeScreen({ user }: { user: Doc<"users"> }) {
  return (
    <StatusScreen title={user.name ? `Hoi ${user.name}` : "Hoi"}>
      <Text style={ui.muted}>{user.email}</Text>
      <SignOutButton />
    </StatusScreen>
  );
}
