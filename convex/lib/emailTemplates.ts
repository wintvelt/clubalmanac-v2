// WP5: NL-templates voor applicatie-emails.
//
// 1:1 port van oude SES-templates uit blob-images-api*-repo's
// (zie WP5-email.md §"Inventarisatie oude SES-templates"). Tone-of-voice
// bewust niet gewijzigd: informeel "Hi ${name},", NL throughout, geen
// inline signature-image (oude AWS gebruikte S3-hosted PNG; v2 gebruikt
// tekst-afsluiting om hosting-dependency te vermijden).
//
// PII-guard: alleen de `invite`-template bevat de invite-token. Notify-
// templates (accepted/declined/bounced) gaan naar de inviter — daar mag
// het token niet in (info-leak via mail-forward).

export type TemplateBlock = { subject: string; htmlPart: string; textPart: string };

const SIGNATURE_TEXT = "Groet,\nClubalmanac";
const SIGNATURE_HTML = "<p>Groet,<br/>Clubalmanac</p>";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// kind = "invite" (naar geïnviteerde)
// ---------------------------------------------------------------------------
export function inviteTemplate(opts: {
  inviterName: string;
  groupName: string | undefined;
  message?: string;
  inviteUrl: string;
  token: string;
  expirationDate: string; // already formatted NL-date string
}): TemplateBlock {
  const groupRef = opts.groupName ?? "clubalmanac";
  const subject = opts.groupName
    ? `${opts.inviterName} nodigt je uit om lid te worden van "${opts.groupName}"`
    : `${opts.inviterName} nodigt je uit op clubalmanac`;

  const messageHtml = opts.message
    ? `<p><em>"${escapeHtml(opts.message)}"</em></p>`
    : "";
  const messageText = opts.message ? `\n"${opts.message}"\n` : "";

  const htmlPart = `
<p>Hi,</p>
<p>${escapeHtml(opts.inviterName)} nodigt je uit om lid te worden van ${escapeHtml(groupRef)} op clubalmanac.</p>
${messageHtml}
<p><a href="${escapeHtml(opts.inviteUrl)}">Bekijk online</a></p>
<p>Of plak deze code op de uitnodigingspagina: ${escapeHtml(opts.token)}</p>
<p>Deze uitnodiging is geldig tot ${escapeHtml(opts.expirationDate)}.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi,

${opts.inviterName} nodigt je uit om lid te worden van ${groupRef} op clubalmanac.
${messageText}
Bekijk online: ${opts.inviteUrl}

Of plak deze code op de uitnodigingspagina: ${opts.token}

Deze uitnodiging is geldig tot ${opts.expirationDate}.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "accepted" (naar inviter)
// ---------------------------------------------------------------------------
export function acceptedTemplate(opts: {
  inviterName: string;
  accepterName: string;
  groupName: string | undefined;
}): TemplateBlock {
  const groupRef = opts.groupName ?? "clubalmanac";
  const subject = opts.groupName
    ? `${opts.accepterName} heeft je uitnodiging om lid te worden van "${opts.groupName}" geaccepteerd`
    : `${opts.accepterName} heeft je uitnodiging op clubalmanac geaccepteerd`;

  const htmlPart = `
<p>Hi ${escapeHtml(opts.inviterName)},</p>
<p>Yeey! ${escapeHtml(opts.accepterName)} heeft je uitnodiging om lid te worden van ${escapeHtml(groupRef)} geaccepteerd (en terecht).</p>
<p>Kijk op de ${escapeHtml(groupRef)} pagina om te zien of er nieuws is.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi ${opts.inviterName},

Yeey! ${opts.accepterName} heeft je uitnodiging om lid te worden van ${groupRef} geaccepteerd (en terecht).

Kijk op de ${groupRef} pagina om te zien of er nieuws is.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "declined" (naar inviter)
// ---------------------------------------------------------------------------
export function declinedTemplate(opts: {
  inviterName: string;
  declinerName: string;
  groupName: string | undefined;
}): TemplateBlock {
  const groupRef = opts.groupName ?? "clubalmanac";
  const subject = opts.groupName
    ? `Helaas! ${opts.declinerName} heeft je uitnodiging om lid te worden van "${opts.groupName}" afgewezen`
    : `Helaas! ${opts.declinerName} heeft je uitnodiging op clubalmanac afgewezen`;

  const htmlPart = `
<p>Hi ${escapeHtml(opts.inviterName)},</p>
<p>Balen! ${escapeHtml(opts.declinerName)} heeft je uitnodiging om lid te worden van ${escapeHtml(groupRef)} afgewezen.</p>
<p>Typisch geval van ongepast eigen initiatief. Vind troost en gezelligheid bij vrienden op de ${escapeHtml(groupRef)} pagina.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi ${opts.inviterName},

Balen! ${opts.declinerName} heeft je uitnodiging om lid te worden van ${groupRef} afgewezen. Typisch geval van ongepast eigen initiatief. Vind troost en gezelligheid bij vrienden op de ${groupRef} pagina.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "bounced" (naar inviter) — nieuw in v2, oude AWS had geen template
// ---------------------------------------------------------------------------
export function bouncedTemplate(opts: {
  inviterName: string;
  bouncedEmail: string;
  groupName: string | undefined;
}): TemplateBlock {
  const subject = opts.groupName
    ? `Je uitnodiging voor "${opts.groupName}" kon niet worden afgeleverd`
    : `Je uitnodiging via clubalmanac kon niet worden afgeleverd`;

  const groupRef = opts.groupName ?? "clubalmanac";

  const htmlPart = `
<p>Hi ${escapeHtml(opts.inviterName)},</p>
<p>De uitnodiging die je naar ${escapeHtml(opts.bouncedEmail)} hebt gestuurd voor ${escapeHtml(groupRef)} is teruggekomen.</p>
<p>Het emailadres lijkt niet (meer) te bestaan. Controleer of het adres klopt en probeer het opnieuw.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi ${opts.inviterName},

De uitnodiging die je naar ${opts.bouncedEmail} hebt gestuurd voor ${groupRef} is teruggekomen. Het emailadres lijkt niet (meer) te bestaan. Controleer of het adres klopt en probeer het opnieuw.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "flagDecisionDeny" (naar photo-owner)
// ---------------------------------------------------------------------------
export function flagDecisionDenyTemplate(opts: {
  ownerName: string;
}): TemplateBlock {
  const subject = `Je bezwaar over een melding voor ongepaste inhoud is afgewezen`;

  const htmlPart = `
<p>Hi ${escapeHtml(opts.ownerName)},</p>
<p>HELAAS: Je bezwaar op de melding op 1 van je foto's is afgewezen.</p>
<p>De foto zal binnenkort definitief van clubalmanac worden verwijderd.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi ${opts.ownerName},

HELAAS: Je bezwaar op de melding op 1 van je foto's is afgewezen. De foto zal binnenkort definitief van clubalmanac worden verwijderd.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "problemReport" (naar webmaster)
// ---------------------------------------------------------------------------
export function problemReportTemplate(opts: {
  submitterName: string;
  submitterEmail: string;
  description: string;
  title: string;
  stage: string;
  timestamp: string;
}): TemplateBlock {
  const subject = `Probleem gemeld op ${opts.stage}`;

  const htmlPart = `
<p>Hi Admin,</p>
<p>Er is een probleem gemeld op de ${escapeHtml(opts.stage)} omgeving.</p>
<p>Door ${escapeHtml(opts.submitterName)}, vanaf ${escapeHtml(opts.submitterEmail)}, op ${escapeHtml(opts.timestamp)}.</p>
<p><strong>${escapeHtml(opts.title)}</strong></p>
<p>"${escapeHtml(opts.description)}"</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi Admin,

Er is een probleem gemeld op de ${opts.stage} omgeving. Door ${opts.submitterName}, vanaf ${opts.submitterEmail}, op ${opts.timestamp}.

${opts.title}

"${opts.description}"

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "monitor-drift-alert" (naar webmaster) — WP10
// ---------------------------------------------------------------------------
// PII-grens (invariant 9): de aanroeper levert al genormaliseerde drift-regels
// die uitsluitend table-namen + record-IDs + counts bevatten. Geen user-content
// (geen namen, emails, rating-comments, photo-bytes). De template echoot die
// regels één-op-één en voegt geen extra velden toe.
export function monitorDriftAlertTemplate(opts: {
  lines: string[];
  timestamp: string;
}): TemplateBlock {
  const subject = `Clubalmanac integriteits-check: drift gedetecteerd (${opts.lines.length})`;

  const listHtml = opts.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  const listText = opts.lines.map((l) => `- ${l}`).join("\n");

  const htmlPart = `
<p>Hi Admin,</p>
<p>De dagelijkse integriteits-check vond ${opts.lines.length} drift-rij(en) op ${escapeHtml(opts.timestamp)}.</p>
<ul>${listHtml}</ul>
<p>Detect-only: er is niets automatisch gerepareerd. Onderzoek de root-cause en herstel handmatig.</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi Admin,

De dagelijkse integriteits-check vond ${opts.lines.length} drift-rij(en) op ${opts.timestamp}.

${listText}

Detect-only: er is niets automatisch gerepareerd. Onderzoek de root-cause en herstel handmatig.

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// ---------------------------------------------------------------------------
// kind = "monitor-heartbeat" (naar webmaster) — WP10
// ---------------------------------------------------------------------------
// Maandelijkse "alive"-mail (invariant 6). Passive meta-monitoring zodat
// afwezigheid-van-mail niet als "geen drift" wordt gelezen.
//
// `driftPresent` (audit N-1): een heartbeat kan op een gededupte-drift-run
// vuren — dan ís er openstaande drift die alleen geen nieuwe mail meer
// triggert. De tekst krijgt dan een waarschuwings-tak (verwijst naar het
// dashboard-log) i.p.v. de geruststellende "geen nieuwe drift"-tekst, zodat
// de heartbeat geen vals "alles in orde" suggereert.
export function monitorHeartbeatTemplate(opts: {
  timestamp: string;
  driftPresent: boolean;
}): TemplateBlock {
  const subject = `Clubalmanac integriteits-check: maandelijkse heartbeat`;

  const statusHtml = opts.driftPresent
    ? `<p><strong>Let op:</strong> er is openstaande drift die door dedup geen nieuwe alert-mail meer triggert. Raadpleeg het Convex dashboard-log voor de actuele drift-rijen.</p>`
    : `<p>Geen nieuwe drift sinds de vorige melding.</p>`;
  const statusText = opts.driftPresent
    ? `Let op: er is openstaande drift die door dedup geen nieuwe alert-mail meer triggert. Raadpleeg het Convex dashboard-log voor de actuele drift-rijen.`
    : `Geen nieuwe drift sinds de vorige melding.`;

  const htmlPart = `
<p>Hi Admin,</p>
<p>De dagelijkse integriteits-check draait nog (stand ${escapeHtml(opts.timestamp)}).</p>
${statusHtml}
<p>Deze maandelijkse heartbeat bevestigt dat de monitor actief is — afwezigheid van mail is dus géén bewijs van "geen drift".</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi Admin,

De dagelijkse integriteits-check draait nog (stand ${opts.timestamp}).

${statusText}

Deze maandelijkse heartbeat bevestigt dat de monitor actief is — afwezigheid van mail is dus geen bewijs van "geen drift".

${SIGNATURE_TEXT}`;

  return { subject, htmlPart, textPart };
}

// Helper: NL-style date format voor invite-expiry. Output bv. "31-12-2026".
export function formatNlDate(timestamp: number): string {
  const d = new Date(timestamp);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Helper: invite-URL voor de landing-pagina. Frontend leeft op
// `https://<deployment>.<region>.convex.site` of een custom-domain — we gebruiken
// `CLUBALMANAC_APP_URL` env-var. Audit-follow-up 2026-05-17 (S-3): geen
// silent fallback meer naar `"https://clubalmanac.com"` — dat zou
// dev-deployment-mails met prod-domain invite-links genereren. Fail-loud
// met `APP_URL_MISSING:`-prefix zodat ops het in logs direct ziet.
export function buildInviteUrl(token: string): string {
  const raw = process.env.CLUBALMANAC_APP_URL;
  if (raw === undefined || raw === "") {
    throw new Error("APP_URL_MISSING: CLUBALMANAC_APP_URL env-var unset");
  }
  const base = raw.replace(/\/+$/, "");
  return `${base}/invite/${encodeURIComponent(token)}`;
}

// Helper: stage-label voor problem-report (dev/prod). Audit-follow-up
// 2026-05-17 (S-3): geen silent fallback naar `"dev"` meer — een
// verkeerd-geconfigureerde prod-deployment zou anders mails versturen met
// label "dev" en dat blijft onopgemerkt. Fail-loud met `STAGE_MISSING:`-
// prefix.
export function getStageLabel(): string {
  const raw = process.env.CLUBALMANAC_STAGE;
  if (raw === undefined || raw === "") {
    throw new Error("STAGE_MISSING: CLUBALMANAC_STAGE env-var unset");
  }
  return raw;
}
