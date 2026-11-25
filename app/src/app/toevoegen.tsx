import { useLocalSearchParams } from "expo-router";
import { AddPhotosScreen } from "../screens/AddPhotosScreen";

// Modaal (src/app/_layout.tsx). WP18: `albumId` komt mee van de "+" op een
// albumroute (src/navigation/TabBar.tsx); zonder kiest de user het album.
// WP36 (besluit 1, U11): ook op het web; Metro kiest daar
// AddPhotosScreen.web.tsx. Geen `toevoegen.web.tsx`: deze route staat in de
// wortel, naast de guard (tests/routeFiles.test.ts).
// WP38 besluit 29.2: onder een groep komt `groupId` mee; het toevoegscherm
// kiest dan een album van die groep.
export default function AddPhotosRoute() {
  const { albumId, groupId } = useLocalSearchParams<{ albumId?: string; groupId?: string }>();
  return (
    <AddPhotosScreen
      albumId={typeof albumId === "string" && albumId !== "" ? albumId : undefined}
      groupId={typeof groupId === "string" && groupId !== "" ? groupId : undefined}
    />
  );
}
