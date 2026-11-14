import { vi } from "vitest";

// WP19c besluit 5: de uitnodiging met groepsfoto gaat via Mailjet's SMTP-ingang
// (`in-v3.mailjet.com`, poort 587) met nodemailer. Spec:
// docs/work-packages/WP19c-uitnodigingsmail-opmaak.md, §Besluit 5 en 6 (A).
//
// Gebruik in een testbestand:
//
//   vi.mock("nodemailer", async () => (await import("./_smtp")).nodemailerMock());
//
// De nep-`createTransport` onthoudt zijn opties en maakt bij `sendMail` de
// echte MIME met nodemailer's eigen `streamTransport` (geen netwerk). Zo toetst
// de test de mail zoals hij de deur uitgaat, ongeacht of B de MIME zelf bouwt
// (`raw`) of nodemailer laat bouwen (`html`, `text`, `attachments`).
// Ontbreekt nodemailer nog (vóór B), dan faalt alleen het SMTP-pad.

export type SmtpSent = {
  /** Wat de code aan `sendMail` gaf. */
  mail: Record<string, unknown>;
  /** De opties van de transport waarmee het ging. */
  transport: Record<string, unknown>;
  /** De mail zoals hij over de lijn zou gaan. */
  raw: string;
  envelope: { from?: string; to?: string[] };
};

export const smtp = {
  transports: [] as Record<string, unknown>[],
  sent: [] as SmtpSent[],
  /** Zet een fout neer: elke `sendMail` faalt daarmee. */
  failWith: null as Error | null,
  reset(): void {
    this.transports = [];
    this.sent = [];
    this.failWith = null;
  },
};

type Real = { createTransport: (o: Record<string, unknown>) => { sendMail: (m: unknown) => Promise<unknown> } };

async function realNodemailer(): Promise<Real> {
  try {
    const mod = (await vi.importActual("nodemailer")) as Real & { default?: Real };
    return mod.default ?? mod;
  } catch {
    throw new Error("nodemailer ontbreekt (WP19c besluit 5: B voegt hem toe)");
  }
}

function createTransport(opts: Record<string, unknown>) {
  smtp.transports.push(opts);
  return {
    async sendMail(mail: Record<string, unknown>) {
      if (smtp.failWith) throw smtp.failWith;
      const real = await realNodemailer();
      const stream = real.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
      const info = (await stream.sendMail(mail)) as {
        message: Buffer;
        envelope: { from?: string; to?: string[] };
        messageId?: string;
      };
      smtp.sent.push({ mail, transport: opts, raw: info.message.toString("utf8"), envelope: info.envelope });
      return { ...info, accepted: info.envelope.to ?? [], rejected: [], response: "250 OK queued" };
    },
    async verify() {
      return true;
    },
    close() {},
  };
}

export function nodemailerMock() {
  return { default: { createTransport }, createTransport };
}

// --- MIME lezen --------------------------------------------------------------------

export type Part = {
  headers: Map<string, string>;
  /** `image/jpeg`, `multipart/related`, … (klein, zonder parameters). */
  type: string;
  params: Record<string, string>;
  children: Part[];
  /** Gedecodeerde inhoud (leeg bij multipart). */
  body: Buffer;
};

function splitHead(block: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(block);
  if (!m) return [block, ""];
  return [block.slice(0, m.index), block.slice(m.index + m[0].length)];
}

function parseHeaders(head: string): Map<string, string> {
  const out = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    // Dubbele headers: de eerste telt, de rest komt erachter (voor tellen).
    out.set(key, out.has(key) ? `${out.get(key)}\n${value}` : value);
  }
  return out;
}

function parseParams(value: string): { main: string; params: Record<string, string> } {
  const [main, ...rest] = value.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { main: (main ?? "").trim().toLowerCase(), params };
}

function decodeQp(s: string): Buffer {
  const soft = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const c = soft[i]!;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(c, "utf8"));
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(body: string, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "7bit").toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (enc === "quoted-printable") return decodeQp(body);
  return Buffer.from(body, "utf8");
}

export function parseMime(raw: string): Part {
  const [head, body] = splitHead(raw);
  const headers = parseHeaders(head);
  const { main, params } = parseParams(headers.get("content-type") ?? "text/plain");
  const part: Part = { headers, type: main, params, children: [], body: Buffer.alloc(0) };
  if (main.startsWith("multipart/") && params.boundary) {
    const b = params.boundary;
    const end = body.indexOf(`--${b}--`);
    const inner = end >= 0 ? body.slice(0, end) : body;
    const chunks = inner.split(new RegExp(`(?:^|\\r?\\n)--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n`));
    for (const chunk of chunks.slice(1)) part.children.push(parseMime(chunk.replace(/\r?\n$/, "")));
    return part;
  }
  part.body = decodeBody(body.replace(/\r?\n$/, ""), headers.get("content-transfer-encoding"));
  return part;
}

/** Alle delen, diepte eerst, met hun ouder. */
export function walk(root: Part): Array<{ part: Part; parent: Part | null }> {
  const out: Array<{ part: Part; parent: Part | null }> = [];
  const go = (p: Part, parent: Part | null) => {
    out.push({ part: p, parent });
    for (const c of p.children) go(c, p);
  };
  go(root, null);
  return out;
}

/** RFC 2047 (`=?UTF-8?B?…?=` en `=?UTF-8?Q?…?=`) terug naar tekst. */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs: string, enc: string, text: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQp(text.replace(/_/g, " ")).toString("utf8"),
    );
}
