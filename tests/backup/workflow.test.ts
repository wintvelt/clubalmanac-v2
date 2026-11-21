import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP37 fixronde 1, punt 3 (A-invariant 35): de maandelijkse backup.
//   - De Convex-export gaat naar S3 vóór elke stap met R2: een probleem met R2
//     (of een volle schijf) mag de Convex-backup niet raken.
//   - R2 gaat naar S3 zonder alle objecten eerst op de runner te zetten
//     (streamend per object, of rclone van bucket naar bucket). Bij ~8 GB aan
//     filmpjes liep de schijf vol en mislukte ook de Convex-backup.
// Getoetst op de vorm van .github/workflows/backup.yml (de stappen en hun
// shell-regels), niet door hem te draaien. Of de kopie echt klopt: runbook en
// de eerste run (audit).
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 35.

const FILE = fileURLToPath(new URL("../../.github/workflows/backup.yml", import.meta.url));

type Step = { index: number; name: string; text: string; run: string };

/** De stappen van de enige job, elk met zijn hele tekst en zijn `run`-script. */
function steps(): Step[] {
  const lines = readFileSync(FILE, "utf8").split("\n");
  const at = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  expect(at, "geen steps: in backup.yml").toBeGreaterThan(0);
  const indent = /^(\s*)/.exec(lines[at + 1] ?? "")![1]!.length;
  const out: Step[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.join("\n");
    const name = /^\s*-?\s*name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? /uses:\s*(\S+)/.exec(text)?.[1] ?? "";
    const runAt = current.findIndex((l) => /^\s*-?\s*run:\s*/.test(l));
    let run = "";
    if (runAt >= 0) {
      const head = current[runAt]!.replace(/^\s*-?\s*run:\s*/, "");
      if (head === "|" || head === ">" || head === "|-") {
        const body = current.slice(runAt + 1);
        const bodyIndent = Math.min(...body.filter((l) => l.trim() !== "").map((l) => /^(\s*)/.exec(l)![1]!.length));
        run = body
          .filter((l) => l.trim() === "" || /^(\s*)/.exec(l)![1]!.length >= bodyIndent)
          .map((l) => l.slice(bodyIndent))
          .join("\n");
      } else {
        run = head;
      }
    }
    out.push({ index: out.length, name, text, run });
  };
  for (const line of lines.slice(at + 1)) {
    // Commentaar hoort bij geen stap (het staat vaak boven de volgende).
    if (line.trim().startsWith("#")) continue;
    if (line.trim() === "") {
      current?.push(line);
      continue;
    }
    const lead = /^(\s*)/.exec(line)![1]!.length;
    if (lead < indent) break;
    if (lead === indent && line.trimStart().startsWith("- ")) {
      flush();
      current = [line];
    } else {
      current?.push(line);
    }
  }
  flush();
  return out;
}

/** Shell-opdrachten: regels met een `\`-voortzetting samengevoegd, opgeknipt in woorden. */
function commands(run: string): string[][] {
  const joined = run.replace(/\\\n/g, " ");
  return joined
    .split(/\n|;|&&|\|\|/)
    .flatMap((part) => part.split("|"))
    .map((c) => c.trim())
    .filter((c) => c !== "" && !c.startsWith("#"))
    .map((c) => c.split(/\s+/).map((w) => w.replace(/^["']|["']$/g, "")));
}

const mentionsR2 = (s: Step) => /R2_BACKUP|r2-videos|r2:/i.test(s.text);
const isRemote = (arg: string) => /^s3:\/\//.test(arg) || /^[A-Za-z0-9_-]+:/.test(arg) || arg === "-";

describe("backup-workflow: eerst Convex, dan R2 (A-invariant 35)", () => {
  it("sanity: er is een stap die snapshot.zip naar de backup-bucket zet, en er zijn stappen met R2", () => {
    const all = steps();
    expect(all.some((s) => /snapshot\.zip\s+"?s3:\/\//.test(s.run))).toBe(true);
    expect(all.some(mentionsR2)).toBe(true);
  });

  it("de Convex-upload staat vóór elke stap die met R2 werkt", () => {
    const all = steps();
    const convexUpload = all.find((s) => /snapshot\.zip\s+"?s3:\/\//.test(s.run))!;
    const r2Steps = all.filter(mentionsR2);
    for (const s of r2Steps) {
      expect(s.index, `stap "${s.name}" (R2) staat vóór de Convex-upload "${convexUpload.name}"`).toBeGreaterThan(convexUpload.index);
    }
  });
});

describe("backup-workflow: R2 niet eerst op de schijf van de runner (A-invariant 35)", () => {
  it("geen aws s3 sync/cp en geen rclone copy/sync van R2 naar een map op de runner", () => {
    const offenders: string[] = [];
    for (const s of steps().filter(mentionsR2)) {
      for (const words of commands(s.run)) {
        const aws = words[0] === "aws" && words[1] === "s3" && (words[2] === "sync" || words[2] === "cp");
        const rclone = words[0] === "rclone" && ["sync", "copy", "copyto", "move"].includes(words[1] ?? "");
        if (!aws && !rclone) continue;
        const positional = words.slice(aws ? 3 : 2).filter((w) => !w.startsWith("--") || w === "-");
        const [src, dst] = positional;
        if (src === undefined || dst === undefined) continue;
        const fromR2 = /R2_BACKUP|^r2/i.test(src) || (aws && words.includes("--endpoint-url") && /^s3:\/\//.test(src));
        if (fromR2 && !isRemote(dst)) offenders.push(`stap "${s.name}": ${words.join(" ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("geen map voor de filmpjes op de runner (mkdir, du of find over een lokale kopie)", () => {
    for (const s of steps().filter(mentionsR2)) {
      expect(s.run, `stap "${s.name}"`).not.toMatch(/\bmkdir\b[^\n]*\br2\b|\bdu\s+-s\w*\s+r2\b|\bfind\s+r2\b/);
    }
  });
});

// --- fixronde 2: de rclone-stap (A-invariant 35) -------------------------------

/** De stap die R2 met rclone naar de backup zet. */
function rcloneStep(): Step {
  const s = steps().find((x) => /\brclone\s+(sync|copy)\b/.test(x.run) && /r2:/.test(x.run));
  expect(s, "geen stap met rclone sync|copy vanaf r2:").toBeTruthy();
  return s!;
}

/** De rclone sync|copy-regel, met voortzettingen samengevoegd. */
function rcloneCommand(run: string): string {
  const line = run
    .replace(/\\\n/g, " ")
    .split("\n")
    .find((l) => /\brclone\s+(sync|copy)\b/.test(l));
  expect(line, "geen rclone sync|copy-regel").toBeTruthy();
  return line!;
}

describe("backup-workflow: de rclone-stap (fixronde 2, A-invariant 35)", () => {
  it("RCLONE_CONFIG_S3BACKUP_NO_HEAD=true (de rol heeft bewust geen GetObject)", () => {
    expect(rcloneStep().text).toMatch(/RCLONE_CONFIG_S3BACKUP_NO_HEAD:\s*["']?true["']?/);
  });

  it("het doel eindigt op /r2-videos/", () => {
    const words = rcloneCommand(rcloneStep().run)
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/^["']|["']$/g, ""));
    const at = words.findIndex((w) => w === "sync" || w === "copy");
    const positional = words.slice(at + 1).filter((w) => !w.startsWith("-"));
    expect(positional[1], `doel: ${positional[1]}`).toMatch(/\/r2-videos\/$/);
  });

  it('--exclude "uploads/**" (tijdelijke uploads horen niet in de backup)', () => {
    expect(rcloneCommand(rcloneStep().run)).toMatch(/--exclude[ =]["']?uploads\/\*\*["']?/);
  });

  it("een grens op wissen: --max-delete, of stoppen als de bron leeg of veel kleiner is", () => {
    const run = rcloneStep().run;
    const cmd = rcloneCommand(run);
    if (/--max-delete[ =]\d+/.test(cmd)) return;
    // Anders: vóór de sync een meting van de bron en een `exit 1` die erop volgt.
    const syncAt = run.indexOf(cmd.trim().split(/\s+/).slice(0, 2).join(" "));
    const before = run.slice(0, syncAt);
    const measured = before.search(/rclone\s+(size|lsf|lsjson|ls)\b[^\n]*r2:/);
    expect(measured, "geen --max-delete en geen meting van de bron vóór de sync").toBeGreaterThanOrEqual(0);
    expect(before.slice(measured), "geen exit 1 na de meting van de bron").toMatch(/exit 1/);
  });

  it("rclone uit een vaste release met checksum, of apt-get update vóór apt-get install; nooit een install-script uit een pipe", () => {
    const run = rcloneStep().run;
    expect(run).not.toMatch(/install\.sh|\|\s*(sudo\s+)?(ba)?sh\b/);
    const apt = run.search(/apt-get\s+install[^\n]*rclone/);
    const download = run.search(/(curl|wget)\b[^\n]*rclone/);
    expect(apt >= 0 || download >= 0, "rclone wordt niet geïnstalleerd in deze stap").toBe(true);
    if (download >= 0) {
      expect(run, "een download zonder checksum").toMatch(/sha256sum\s+(-c|--check)|sha256sum[^\n]*\|\s*grep|echo\s+["']?[0-9a-f]{64}/);
    }
    if (apt >= 0 && download < 0) {
      const update = run.search(/apt-get\s+update/);
      expect(update, "apt-get install zonder apt-get update ervoor").toBeGreaterThanOrEqual(0);
      expect(update).toBeLessThan(apt);
    }
  });
});
