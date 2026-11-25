import type { ConfigContext, ExpoConfig } from "expo/config";
import { withDangerousMod, type ConfigPlugin } from "expo/config-plugins";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// WP42 A8 en B3: de sleutel van Google Maps voor Android staat niet in de
// repo. Hij komt uit de omgeving: de EAS-env-var GOOGLE_MAPS_ANDROID_API_KEY
// (EAS-omgevingen development en production), of lokaal app/.env.local. Zo
// stelt Wouter hem later in zonder codewijziging. De rest staat in app.json.
//
// Zonder sleutel crasht de Maps SDK bij het openen van de kaart. Daarom krijgt
// een build zonder sleutel een nep-waarde: de kaart blijft dan leeg (dev op de
// emulator). Een Android-build voor de leden (EAS-profiel production) zonder
// sleutel stopt hier: een grijze kaart is daar een fail.

const MAPS_KEY_VAR = "GOOGLE_MAPS_ANDROID_API_KEY";
const NO_KEY = "geen-sleutel";

// WP42: een release-build (R8 verkleint de code) crashte bij de start:
// WorkManager (via react-native-maps) maakt zijn database met Room 2.5, en R8
// haalde de lege constructor van de gegenereerde database weg. Deze regel
// houdt hem. Alleen Android; iOS verandert niet.
const ROOM_KEEP_RULE = "-keep class * extends androidx.room.RoomDatabase { <init>(); }";

const withRoomKeepRule: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    "android",
    async (mod) => {
      const file = join(mod.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const rules = readFileSync(file, "utf8");
      if (!rules.includes(ROOM_KEEP_RULE)) {
        writeFileSync(file, `${rules.trimEnd()}\n\n# WP42: Room (WorkManager) in een release-build\n${ROOM_KEEP_RULE}\n`);
      }
      return mod;
    },
  ]);

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env[MAPS_KEY_VAR]?.trim() ?? "";
  if (key === "" && process.env.EAS_BUILD_PLATFORM === "android" && process.env.EAS_BUILD_PROFILE === "production") {
    throw new Error(`${MAPS_KEY_VAR} ontbreekt: een Android-build voor de leden heeft zonder sleutel een lege kaart.`);
  }
  return {
    ...config,
    android: {
      ...config.android,
      config: { ...config.android?.config, googleMaps: { apiKey: key === "" ? NO_KEY : key } },
    },
    plugins: [...(config.plugins ?? []), withRoomKeepRule],
  } as ExpoConfig;
};
