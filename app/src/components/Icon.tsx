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
} as const;

export type IconName = keyof typeof IONICONS;

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
