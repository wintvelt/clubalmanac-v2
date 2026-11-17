import { InModalSheet } from "../../../../../components/useKeyboardReveal";
import { InviteScreen } from "../../../../../screens/InvitesScreens";

// WP19b: modaal in de Home-stack (_layout.tsx). WP32: het toetsenbord meet in
// een modaal blad anders (useKeyboardReveal).
export default function InviteRoute() {
  return (
    <InModalSheet>
      <InviteScreen />
    </InModalSheet>
  );
}
