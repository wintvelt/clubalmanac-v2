import { InModalSheet } from "../../../components/useKeyboardReveal";
import { NewGroupScreen } from "../../../screens/GroupAdminScreens";

// WP28b: modaal in de Home-stack (_layout.tsx). WP32: het toetsenbord meet in
// een modaal blad anders (useKeyboardReveal).
export default function NewGroupRoute() {
  return (
    <InModalSheet>
      <NewGroupScreen />
    </InModalSheet>
  );
}
