import { InModalSheet } from "../../../../../components/useKeyboardReveal";
import { NewAlbumScreen } from "../../../../../screens/GroupAdminScreens";

// WP28b: modaal in de Home-stack (_layout.tsx). WP32: het toetsenbord meet in
// een modaal blad anders (useKeyboardReveal).
export default function NewAlbumRoute() {
  return (
    <InModalSheet>
      <NewAlbumScreen />
    </InModalSheet>
  );
}
