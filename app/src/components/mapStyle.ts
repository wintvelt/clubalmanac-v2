import type { ComponentProps } from "react";
import { Platform } from "react-native";
import type MapView from "react-native-maps";
import type { ColorScheme } from "../theme";

// WP42 A8, B3 (a1): de kaart op Android is Google Maps. Die volgt het donkere
// thema niet vanzelf en toont standaard bedrijven en andere plekken; op iOS
// (Apple Maps) volgt de kaart het thema en staan die uit
// (`showsPointsOfInterests={false}`). Daarom op Android een eigen stijl: in
// licht alleen zonder plekken, in donker de nachtstijl van Google. Op iOS geen
// extra props: daar verandert niets.

type MapStyle = NonNullable<ComponentProps<typeof MapView>["customMapStyle"]>;

const NO_PLACES: MapStyle = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

// De nachtstijl uit de voorbeelden van Google Maps Platform.
const NIGHT: MapStyle = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

const LIGHT_STYLE: MapStyle = NO_PLACES;
const DARK_STYLE: MapStyle = [...NIGHT, ...NO_PLACES];

/** De extra props voor een `MapView` op Android; op iOS en het web leeg. */
export function androidMapProps(scheme: ColorScheme): { customMapStyle?: MapStyle } {
  if (Platform.OS !== "android") return {};
  return { customMapStyle: scheme === "dark" ? DARK_STYLE : LIGHT_STYLE };
}
