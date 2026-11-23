import { isDevDeployment } from "../lib/originalProbe";

// WP38b: proefschermen alleen in een build tegen de dev-deployment (EAS-
// profiel `dev` zet daar EXPO_PUBLIC_CONVEX_URL op). Letterlijke toegang: Expo
// neemt de var alleen zo op in de build.
export const DEV_TOOLS = isDevDeployment(process.env.EXPO_PUBLIC_CONVEX_URL);
