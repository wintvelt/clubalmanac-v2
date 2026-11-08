import { useLocalSearchParams } from "expo-router";
import { AddPhotosScreen } from "../screens/AddPhotosScreen";

// Modaal (src/app/_layout.tsx). WP18: `albumId` komt mee van de "+" op een
// albumroute (src/navigation/TabBar.tsx); zonder kiest de user het album.
export default function AddPhotosRoute() {
  const { albumId } = useLocalSearchParams<{ albumId?: string }>();
  return <AddPhotosScreen albumId={typeof albumId === "string" && albumId !== "" ? albumId : undefined} />;
}
