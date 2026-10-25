// Eén bron voor stijl (WP-Design invariant 2). Waarden uit docs/design.md
// §2–4. Schermen en componenten gebruiken alleen deze tokens. Mist er iets,
// vul het hier aan, niet lokaal. Geen React Native-import: de tests lezen
// dit bestand in Node.

export type ColorScheme = "light" | "dark";

export type ColorTokens = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  primary: string;
  cta: string;
  onCta: string;
  ctaText: string;
  tabbar: string;
  tabInactive: string;
  tabPill: string;
  segBg: string;
  segOn: string;
  onSegOn: string;
  field: string;
  fieldLine: string;
  danger: string;
  success: string;
  onGradient: string;
  gradStart: string;
  gradEnd: string;
  washStart: string;
  washEnd: string;
};

export const colors: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: "#F1F5F9",
    surface: "#FFFFFF",
    text: "#0F172A",
    muted: "#475569",
    line: "#E2E8F0",
    primary: "#0369A1",
    cta: "#C2410C",
    onCta: "#FFFFFF",
    ctaText: "#9A3412",
    tabbar: "#F8FAFC",
    tabInactive: "#475569",
    tabPill: "#E0F2FE",
    segBg: "#E2E8F0",
    segOn: "#0369A1",
    onSegOn: "#FFFFFF",
    field: "#FFFFFF",
    fieldLine: "#64748B",
    danger: "#DC2626",
    success: "#15803D",
    onGradient: "#0F172A",
    gradStart: "#A3E635",
    gradEnd: "#0EA5E9",
    washStart: "#F7FEE7",
    washEnd: "#E0F2FE",
  },
  dark: {
    bg: "#020617",
    surface: "#0F172A",
    text: "#E2E8F0",
    muted: "#94A3B8",
    line: "#1E293B",
    primary: "#7DD3FC",
    cta: "#FB923C",
    onCta: "#1C0A02",
    ctaText: "#FB923C",
    tabbar: "#0B1222",
    tabInactive: "#94A3B8",
    tabPill: "#0C4A6E",
    segBg: "#1E293B",
    segOn: "#7DD3FC",
    onSegOn: "#0F172A",
    field: "#0F172A",
    fieldLine: "#64748B",
    danger: "#F87171",
    success: "#4ADE80",
    onGradient: "#0F172A",
    gradStart: "#A3E635",
    gradEnd: "#0EA5E9",
    washStart: "#14240A",
    washEnd: "#082F49",
  },
};

// Verloop: sky-500 vol vanaf 76% (38% lime). 135° voor vlakken, 90° voor
// het streepje naast een jaartal.
export const gradientStops = [0, 0.76, 1] as const;

// Tekst op foto's staat nooit los: altijd op een van deze lagen, met wit erop.
export const photoLayers = {
  // Zwart, van boven naar onder: 62%, 55% op 100 pt, 0% onderaan.
  coverScrim: { top: 0.62, at100: 0.55, bottom: 0 },
  pill: { color: "#0F172A", opacity: 0.62, blur: 8 },
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 22, xxl: 28 } as const;

export const size = {
  screenMargin: 16,
  touchMin: 44,
  button: 54,
  field: 56,
  row: 56,
  smallButton: 44,
  segTab: 44,
  plus: 58,
  plusRise: 26,
  tabbar: 66,
  noticeIcon: 26,
  emptyIcon: 84,
  // Leesbare tekstkolom op iPad en liggend (design.md §9).
  maxTextColumn: 640,
} as const;

export const radius = {
  button: 14,
  field: 12,
  card: 14,
  listBlock: 12,
  albumTile: 12,
  groupPhoto: 16,
  pill: 999,
} as const;

export const border = {
  field: 1.5,
  fieldFocus: 2.5,
  secondaryButton: 2,
  notice: 2,
  plusLight: 1.5,
} as const;

// Literata zit in de build (expo-font-plugin in app.json), dus geen flits van
// de systeemletter. Op iOS heet hij naar zijn PostScript-naam.
export const LITERATA = "Literata-SemiBold";

type Weight = "400" | "600" | "700";

export type TypeRole = {
  fontSize: number;
  fontWeight?: Weight;
  fontFamily?: string;
  // Alleen de tabbalk-labels hebben een grens. Alle andere tekst schaalt vrij
  // mee met de iOS-tekstgrootte, ook in de AX-standen (design.md §3).
  maxFontSizeMultiplier?: number;
};

// Groottes in pt bij de standaard-tekststand. Basistekst 18 voor 50+.
export const typography = {
  largeTitle: { fontSize: 34, fontWeight: "700" },
  title: { fontSize: 30, fontWeight: "700" },
  yearLarge: { fontSize: 38, fontFamily: LITERATA },
  yearSmall: { fontSize: 22, fontFamily: LITERATA },
  emptyTitle: { fontSize: 22, fontWeight: "700" },
  groupName: { fontSize: 21, fontWeight: "600" },
  body: { fontSize: 18, fontWeight: "400" },
  bodyStrong: { fontSize: 18, fontWeight: "700" },
  listRow: { fontSize: 18, fontWeight: "400" },
  button: { fontSize: 18, fontWeight: "700" },
  meta: { fontSize: 17, fontWeight: "400" },
  backPill: { fontSize: 17, fontWeight: "600" },
  albumName: { fontSize: 17, fontWeight: "600" },
  albumMeta: { fontSize: 15, fontWeight: "400" },
  fieldLabel: { fontSize: 16, fontWeight: "600" },
  smallButton: { fontSize: 16, fontWeight: "700" },
  badge: { fontSize: 14, fontWeight: "700" },
  tabLabel: { fontSize: 13, fontWeight: "600", maxFontSizeMultiplier: 1.2 },
  tabLabelActive: { fontSize: 13, fontWeight: "700", maxFontSizeMultiplier: 1.2 },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof typography;
