import { useLocalSearchParams } from "expo-router";
import { AddPhotosScreen } from "../screens/AddPhotosScreen";

// Modaal (src/app/_layout.tsx). WP18: `albumId` komt mee van de "+" op een
// albumroute (src/navigation/TabBar.tsx); zonder kiest de user het album.
// WP36 (besluit 1, U11): ook op het web; Metro kiest daar
// AddPhotosScreen.web.tsx. Geen `toevoegen.web.tsx`: deze route staat in de
// wortel, naast de guard (tests/routeFiles.test.ts).
export default function AddPhotosRoute() {
  const { albumId } = useLocalSearchParams<{ albumId?: string }>();
  return <AddPhotosScreen albumId={typeof albumId === "string" && albumId !== "" ? albumId : undefined} />;
}
