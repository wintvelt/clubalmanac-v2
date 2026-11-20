import { useLocalSearchParams } from "expo-router";
import { READ_ONLY } from "../data/readOnly";
import { AddPhotosScreen } from "../screens/AddPhotosScreen";
import { NotOnWebScreen } from "../screens/NotOnWebScreen";

// Modaal (src/app/_layout.tsx). WP18: `albumId` komt mee van de "+" op een
// albumroute (src/navigation/TabBar.tsx); zonder kiest de user het album.
// WP35 W5: op het web niet uploaden. Geen `toevoegen.web.tsx`: deze route
// staat in de wortel, naast de guard (tests/routeFiles.test.ts).
export default function AddPhotosRoute() {
  const { albumId } = useLocalSearchParams<{ albumId?: string }>();
  if (READ_ONLY) return <NotOnWebScreen />;
  return <AddPhotosScreen albumId={typeof albumId === "string" && albumId !== "" ? albumId : undefined} />;
}
