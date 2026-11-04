import { PlaceholderScreen } from "../../../../../../screens/PlaceholderScreen";

// WP17 vult het albumscherm met de foto's en markSeen. WP16 roept markSeen
// niet aan: de teller blijft staan (invariant 3).
export default function AlbumRoute() {
  return <PlaceholderScreen icon="photos" text="Hier zie je straks de foto's van dit album." />;
}
