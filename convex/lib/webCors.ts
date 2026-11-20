// WP35 A-invariant W1 en W2: CORS voor de webapp, alleen op de beeldpaden met
// een login (`/beeld/foto/*` en `/beeld/uitnodiging/*`). De webapp haalt een
// beeld op met `fetch` en het Clerk-token in de `Authorization`-header; die
// header maakt het verzoek "niet eenvoudig", dus de browser vraagt eerst
// `OPTIONS`.
//
// - De toegestane origins staan per deployment in `CLUBALMANAC_WEB_ORIGINS`
//   (komma-gescheiden, exacte origins: schema, host en eventueel poort; geen
//   pad, geen `/` aan het eind, geen `*`). Op prod (`CLUBALMANAC_STAGE=prod`)
//   telt alleen `https://`.
// - Fail-loud zonder de iPhone te raken: ontbreekt de variabele of is een
//   waarde ongeldig, dan telt die waarde niet en logt een verzoek uit de
//   browser (met `Origin`) een fout met de naam van de variabele. Een verzoek
//   zonder `Origin` (de iPhone-app) merkt er niets van.
// - Nooit `*` en nooit `Access-Control-Allow-Credentials`: er gaan geen
//   cookies mee, alleen de header.
// - De toegang verandert niet: de header komt op elk antwoord aan een
//   toegestane origin (200, 400, 401, 404), zodat de app een 401 ziet en een
//   vers token haalt.

export const WEB_ORIGINS_ENV = "CLUBALMANAC_WEB_ORIGINS";

// Een uur: de browser onthoudt de preflight per URL zo lang.
const PREFLIGHT_MAX_AGE = "3600";

type OriginConfig = { allowed: Set<string>; problem: string | null };

// Een exacte origin: `http(s)://host[:poort]`, niets erachter. `new URL`
// normaliseert (kleine letters, standaardpoort weg), dus de waarde moet gelijk
// zijn aan zijn eigen `origin`.
function exactOrigin(value: string, httpsOnly: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
  if (url.origin !== value) return null;
  return url.origin;
}

function readConfig(): OriginConfig {
  const raw = process.env[WEB_ORIGINS_ENV];
  if (raw === undefined || raw.trim() === "") {
    return { allowed: new Set(), problem: `${WEB_ORIGINS_ENV} ontbreekt of is leeg` };
  }
  const httpsOnly = process.env.CLUBALMANAC_STAGE?.trim() === "prod";
  const allowed = new Set<string>();
  const rejected: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "") continue;
    const origin = exactOrigin(value, httpsOnly);
    if (origin) allowed.add(origin);
    else rejected.push(value);
  }
  if (rejected.length > 0) {
    const why = httpsOnly ? "geen exacte https-origin" : "geen exacte origin";
    return {
      allowed,
      problem: `${WEB_ORIGINS_ENV} bevat ${rejected.length} ongeldige waarde(n) (${why}): ${JSON.stringify(rejected)}`,
    };
  }
  if (allowed.size === 0) {
    return { allowed, problem: `${WEB_ORIGINS_ENV} bevat geen origin` };
  }
  return { allowed, problem: null };
}

/**
 * De toegestane origin van dit verzoek, of `null`. Zonder `Origin` (de
 * iPhone-app) altijd `null`, zonder log. Met `Origin` en een probleem in de
 * env-var: een fout in de log met de naam.
 */
export function allowedWebOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin === null) return null;
  const config = readConfig();
  if (config.problem) console.error(`[webCors] ${config.problem}`);
  return config.allowed.has(origin) ? origin : null;
}

function addVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  const parts = (current ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (parts.some((p) => p.toLowerCase() === value.toLowerCase() || p === "*")) return;
  headers.set("Vary", [...parts, value].join(", "));
}

/**
 * Het antwoord met de CORS-header voor een toegestane origin. Een verzoek met
 * een andere origin krijgt alleen `Vary: Origin` erbij (het antwoord hangt van
 * de origin af); een verzoek zonder `Origin` blijft ongewijzigd.
 */
export function withWebCors(request: Request, response: Response): Response {
  if (request.headers.get("Origin") === null) return response;
  const origin = allowedWebOrigin(request);
  const headers = new Headers(response.headers);
  addVary(headers, "Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * De preflight (`OPTIONS`): 204 met de CORS-headers voor een toegestane
 * origin, anders 403 zonder. Hangt niet af van het pad of het id: een
 * bestaand en een onbekend beeld geven hetzelfde antwoord.
 */
export function webPreflightResponse(request: Request): Response {
  const origin = allowedWebOrigin(request);
  if (!origin) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
      Vary: "Origin",
    },
  });
}
