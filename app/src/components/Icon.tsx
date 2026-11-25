import Ionicons from "@expo/vector-icons/Ionicons";

// Ionicons (design.md §5). Eigen namen, zodat een scherm niet aan de set
// vastzit. Elk icoon bestaat als lijn (standaard) en gevuld (actieve tab).
const IONICONS = {
  home: "home",
  photos: "images",
  plus: "add",
  user: "person",
  gear: "settings",
  login: "log-in",
  mail: "mail",
  info: "information-circle",
  back: "chevron-back",
  chevron: "chevron-forward",
  groups: "people",
  flag: "flag",
  edit: "create",
  logout: "exit",
  trash: "trash",
  alert: "alert-circle",
  check: "checkmark-circle",
  refresh: "refresh",
  privacy: "shield-checkmark",
  document: "document-text",
  more: "ellipsis-horizontal-circle",
  rotateLeft: "arrow-undo",
  rotateRight: "arrow-redo",
  mirror: "swap-horizontal",
  circle: "ellipse",
  map: "map",
  pin: "location",
  share: "share",
  // WP39: "Toevoegen aan album" en de × op een tegel in het toevoegscherm.
  upload: "cloud-upload",
  // WP40: "Naar album" en "Uit album" in de selectiebalk.
  album: "albums",
  minus: "remove-circle",
  close: "close-circle",
  idea: "bulb",
  problem: "bug",
  vote: "thumbs-up",
  // WP21: de clubfilms.
  film: "film",
  play: "play-circle",
  // WP38c (besluit 1 na A): "Filmproject starten", alleen voor de oprichter.
  key: "key",
  // WP38c: de downloadpagina.
  download: "download",
  // WP38 (feedback na besluit 27): de knoppen van de oprichter.
  lock: "lock-closed",
  calendar: "calendar",
} as const;

export type IconName = keyof typeof IONICONS;

/** De naam in Ionicons: lijn (standaard) of gevuld. Ook voor GradientIcon.web.tsx. */
export function ioniconName(name: IconName, filled = false): string {
  const base = IONICONS[name];
  return filled ? base : `${base}-outline`;
}

type Props = { name: IconName; size?: number; color: string; filled?: boolean };

// Decoratief voor VoiceOver: de knop of rij eromheen draagt het label.
export function Icon({ name, size = 24, color, filled = false }: Props) {
  const base = IONICONS[name];
  return (
    <Ionicons
      name={filled ? base : `${base}-outline`}
      size={size}
      color={color}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
