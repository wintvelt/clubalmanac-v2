import { anyApi } from "convex/server";
import type { api as generatedApi } from "../../convex/_generated/api";

// WP13 invariant 1: de types komen uit convex/_generated van deze repo. Breekt
// een backend-wijziging een aanroep, dan faalt de typecheck van de app.
// Runtime is dit precies wat convex/_generated/api.js doet (`api = anyApi`),
// maar dan met de convex-kopie van de app. Zo bundelt Metro niets van buiten
// app/ en draait er maar één convex in de app.
export const api = anyApi as unknown as typeof generatedApi;
