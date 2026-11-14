// WP5: NL-templates voor applicatie-emails.
//
// 1:1 port van oude SES-templates uit blob-images-api*-repo's
// (zie WP5-email.md §"Inventarisatie oude SES-templates"). Tone-of-voice
// bewust niet gewijzigd: informeel "Hi ${name},", NL throughout, geen
// inline signature-image (oude AWS gebruikte S3-hosted PNG; v2 gebruikt
// tekst-afsluiting om hosting-dependency te vermijden).
//
// PII-guard: geen enkele template bevat het invite-token (WP19b
// A-invariant 4: ook de uitnodigingsmail niet meer).

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
// WP19c: de HTML-schil in de stijl van de app (A-invariant 8)
// ---------------------------------------------------------------------------
// Eén kolom op een `surface`-kaart, de tokens van docs/design.md §2 in licht en
// donker, de systeemletter. Geen externe bronnen: geen webfont, `<link>`,
// `<script>` of `url(`; elk beeld is een `cid:`-bijlage. De lichte kleuren
// staan ook inline, voor clients die `<style>` weggooien; het donkere blok
// overschrijft ze met `!important`. Nu alleen voor de uitnodiging (A, open
// vraag 3); de andere mails aan leden kunnen hem later krijgen.

const LIGHT = { bg: "#F1F5F9", surface: "#FFFFFF", text: "#0F172A", muted: "#475569", cta: "#C2410C", onCta: "#FFFFFF" };
const DARK = { bg: "#020617", surface: "#0F172A", text: "#E2E8F0", muted: "#94A3B8", cta: "#FB923C", onCta: "#1C0A02" };
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function emailShell(opts: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(opts.title)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; background: ${LIGHT.bg}; color: ${LIGHT.text}; font-family: ${FONT}; }
.ca-bg { background: ${LIGHT.bg}; }
.ca-card { background: ${LIGHT.surface}; }
.ca-text { color: ${LIGHT.text}; }
.ca-muted { color: ${LIGHT.muted}; }
.ca-cta { background: ${LIGHT.cta}; color: ${LIGHT.onCta}; }
@media (prefers-color-scheme: dark) {
  body, .ca-bg { background: ${DARK.bg} !important; color: ${DARK.text} !important; }
  .ca-card { background: ${DARK.surface} !important; }
  .ca-text { color: ${DARK.text} !important; }
  .ca-muted { color: ${DARK.muted} !important; border-color: ${DARK.muted} !important; }
  .ca-cta { background: ${DARK.cta} !important; color: ${DARK.onCta} !important; }
}
</style>
</head>
<body class="ca-bg" style="margin:0;padding:0;background:${LIGHT.bg};color:${LIGHT.text};font-family:${FONT};">
<table role="presentation" class="ca-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LIGHT.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="ca-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${LIGHT.surface};border-radius:16px;">
<tr><td class="ca-text" style="padding:24px;color:${LIGHT.text};font-family:${FONT};font-size:18px;line-height:1.5;">
${opts.body}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Tekst als HTML, met een regeleinde als `<br>`. */
function htmlLines(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

// ---------------------------------------------------------------------------
// kind = "invite" (naar geïnviteerde)
// ---------------------------------------------------------------------------
// WP19b besluit 1, A-invariant 4 en 13: geen persoonlijke link en geen token.
// Wel wie uitnodigt, de groep, het adres waarmee de genodigde inlogt, tot
// wanneer, en dat hij de app installeert en met dat adres inlogt. De aanhef
// met de naam uit de uitnodiging (een gemigreerde heeft er geen) en het
// bericht.
//
// WP19c: opmaak in de schil hierboven (A-invariant 8), de groepsfoto als
// `cid:`-bijlage bovenaan (A-invariant 1, 6, 11) en één vaste App Store-link
// (A-invariant 9). De tekstversie heeft dezelfde inhoud, zonder beeld
// (A-invariant 10).
export const INVITE_PHOTO_CONTENT_ID = "groepsfoto";
export const INVITE_PHOTO_FILENAME = "groepsfoto.jpg";

export function inviteTemplate(opts: {
  inviterName: string;
  groupName: string | undefined;
  inviteeName?: string;
  inviteeEmail: string;
  message?: string;
  expirationDate: string; // already formatted NL-date string
  /** De groepsfoto als bijlage `cid:${INVITE_PHOTO_CONTENT_ID}`, met zijn breedte in px. */
  photo?: { width: number };
  /** De vaste link naar de app in de App Store; zonder: geen link. */
  appStoreUrl?: string;
}): TemplateBlock {
  const groupRef = opts.groupName ?? "clubalmanac";
  const subject = opts.groupName
    ? `${opts.inviterName} nodigt je uit om lid te worden van "${opts.groupName}"`
    : `${opts.inviterName} nodigt je uit op clubalmanac`;

  const greetingText = opts.inviteeName ? `Hi ${opts.inviteeName},` : "Hi,";
  const greetingHtml = opts.inviteeName ? `Hi ${escapeHtml(opts.inviteeName)},` : "Hi,";
  const p = (html: string, extra = "") => `<p class="ca-text" style="margin:0 0 16px;color:${LIGHT.text};${extra}">${html}</p>`;

  const photoHtml = opts.photo
    ? `<img src="cid:${INVITE_PHOTO_CONTENT_ID}" width="${opts.photo.width}" alt="Groepsfoto van ${escapeHtml(groupRef)}" style="display:block;max-width:100%;height:auto;border:0;border-radius:16px;margin:0 auto 20px;">`
    : "";
  const messageHtml = opts.message
    ? `<p class="ca-muted" style="margin:0 0 16px;padding:4px 0 4px 16px;border-left:3px solid ${LIGHT.muted};color:${LIGHT.muted};font-style:italic;">${htmlLines(opts.message)}</p>`
    : "";
  const appStoreHtml = opts.appStoreUrl
    ? `${p("Heb je een iPhone? Installeer Clubalmanac uit de App Store.")}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td class="ca-cta" style="background:${LIGHT.cta};border-radius:12px;"><a class="ca-cta" href="${escapeHtml(opts.appStoreUrl)}" style="display:inline-block;padding:14px 24px;background:${LIGHT.cta};color:${LIGHT.onCta};border-radius:12px;font-family:${FONT};font-size:18px;font-weight:700;text-decoration:none;">Naar de App Store</a></td></tr></table>`
    : "";

  const body = [
    `<p class="ca-muted" style="margin:0 0 16px;color:${LIGHT.muted};font-size:16px;font-weight:600;">Clubalmanac</p>`,
    photoHtml,
    `<h1 class="ca-text" style="margin:0 0 12px;color:${LIGHT.text};font-size:30px;line-height:1.2;font-weight:700;">${greetingHtml}</h1>`,
    p(`${escapeHtml(opts.inviterName)} nodigt je uit om lid te worden van <strong>${escapeHtml(groupRef)}</strong> op Clubalmanac.`),
    messageHtml,
    p(`Installeer de app Clubalmanac en log in met dit e-mailadres: <strong>${escapeHtml(opts.inviteeEmail)}</strong>. Na het inloggen zie je de uitnodiging in de app.`),
    appStoreHtml,
    `<p class="ca-muted" style="margin:0 0 16px;color:${LIGHT.muted};font-size:16px;">Deze uitnodiging is geldig tot <span style="white-space:nowrap;">${escapeHtml(opts.expirationDate)}</span>.</p>`,
    p("Groet,<br>Clubalmanac", "margin:0;"),
  ]
    .filter((s) => s !== "")
    .join("\n");

  const htmlPart = emailShell({ title: "Uitnodiging voor Clubalmanac", body });

  const messageText = opts.message ? `\n"${opts.message}"\n` : "";
  const appStoreText = opts.appStoreUrl
    ? `\nHeb je een iPhone? Installeer Clubalmanac uit de App Store:\n${opts.appStoreUrl}\n`
    : "";

  const textPart = `${greetingText}

${opts.inviterName} nodigt je uit om lid te worden van ${groupRef} op Clubalmanac.
${messageText}
Installeer de app Clubalmanac en log in met dit e-mailadres: ${opts.inviteeEmail}. Na het inloggen zie je de uitnodiging in de app.
${appStoreText}
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
// (geen namen, emails, photo-bytes). De template echoot die
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

// ---------------------------------------------------------------------------
// kind = "account-deletion-clerk-failed" (naar webmaster) — WP29
// ---------------------------------------------------------------------------
// A-invariant 7: de Clerk-user kon niet worden verwijderd. PII-grens: alleen
// de Clerk-subject en het Convex-id, geen naam of e-mailadres.
export function accountDeletionClerkFailedTemplate(opts: {
  subject: string;
  userId: string;
  reason: string;
  /** Fix 6: is het opruimen in Convex op het moment van de mail klaar? */
  convexDone: boolean;
  stage: string;
  timestamp: string;
}): TemplateBlock {
  const mailSubject = `Account verwijderen: Clerk-user niet verwijderd (${opts.stage})`;
  const command = `npx convex run users:retryAccountDeletion '{"userId":"${opts.userId}"}'`;
  const convexState = opts.convexDone
    ? "De data in Convex is weg"
    : "Het opruimen in Convex loopt nog (loopt het vast, dan meldt de integriteitscheck het)";

  const htmlPart = `
<p>Hi Admin,</p>
<p>Een lid heeft zijn account verwijderd op de ${escapeHtml(opts.stage)} omgeving. ${escapeHtml(convexState)}, maar de Clerk-user <strong>${escapeHtml(opts.subject)}</strong> kon niet worden verwijderd (${escapeHtml(opts.reason)}, ${escapeHtml(opts.timestamp)}).</p>
<p>Tot dat lukt, blijft de users-rij staan en houdt hij elke login tegen. Herstel de oorzaak (bv. <code>CLERK_SECRET_KEY</code>) en start het opnieuw:</p>
<p><code>${escapeHtml(command)}</code> (op prod met <code>--prod</code>)</p>
${SIGNATURE_HTML}
`.trim();

  const textPart = `Hi Admin,

Een lid heeft zijn account verwijderd op de ${opts.stage} omgeving. ${convexState}, maar de Clerk-user ${opts.subject} kon niet worden verwijderd (${opts.reason}, ${opts.timestamp}).

Tot dat lukt, blijft de users-rij staan en houdt hij elke login tegen. Herstel de oorzaak (bv. CLERK_SECRET_KEY) en start het opnieuw:

${command}   (op prod met --prod)

${SIGNATURE_TEXT}`;

  return { subject: mailSubject, htmlPart, textPart };
}

// Helper: NL-style date format voor invite-expiry. Output bv. "31-12-2026".
export function formatNlDate(timestamp: number): string {
  const d = new Date(timestamp);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
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
