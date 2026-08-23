// WP12 — stap 1: `extract`. DynamoDB → scripts/.data/dynamo-extract.json.
//
// Read-only richting AWS (invariant: "AWS wordt nooit geschreven"). De hele
// tabel gaat er in één full scan uit; filteren gebeurt pas in `transform`,
// zodat je op de transform kunt itereren zonder DynamoDB nog een keer te raken.
//
// Het bestand draagt zijn eigen herkomst: tijdstip, tabel, regio en account.
// In het gefaseerde prod-scenario (bestanden op T-2, records op T-0) is een
// transform op een extract van twee weken oud een reële fout; de latere stappen
// tonen daarom altijd deze meta.

import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { awsSource } from "./config.ts";
import { EXTRACT_FILE, writeData } from "./paths.ts";
import type { SourceItem } from "./types.ts";

export type ExtractMeta = {
  extractedAt: string;
  table: string;
  region: string;
  account: string;
  itemCount: number;
};

export type ExtractFile = { meta: ExtractMeta; items: SourceItem[] };

export async function extract(): Promise<ExtractFile> {
  const source = awsSource();
  console.log(`[extract] bron: ${source.table} @ ${source.region} (read-only)`);

  const base = new DynamoDBClient({ region: source.region });
  const doc = DynamoDBDocumentClient.from(base);

  let account = "onbekend";
  try {
    const described = await base.send(new DescribeTableCommand({ TableName: source.table }));
    // arn:aws:dynamodb:<region>:<account>:table/<naam>
    account = described.Table?.TableArn?.split(":")[4] ?? "onbekend";
  } catch (error) {
    throw new Error(
      `[extract] kan tabel ${source.table} niet lezen in ${source.region}: ${String(error)}`,
    );
  }

  const items: SourceItem[] = [];
  let lastKey: Record<string, unknown> | undefined = undefined;
  let pages = 0;
  do {
    const page: ScanCommandOutput = await doc.send(
      new ScanCommand({ TableName: source.table, ExclusiveStartKey: lastKey }),
    );
    for (const item of (page.Items ?? []) as SourceItem[]) items.push(item);
    lastKey = page.LastEvaluatedKey;
    pages += 1;
    if (pages % 10 === 0) console.log(`[extract] ${items.length} items…`);
  } while (lastKey !== undefined);

  const file: ExtractFile = {
    meta: {
      extractedAt: new Date().toISOString(),
      table: source.table,
      region: source.region,
      account,
      itemCount: items.length,
    },
    items,
  };
  const path = writeData(EXTRACT_FILE, file);
  console.log(`[extract] ${items.length} items in ${pages} pagina's → ${path}`);
  return file;
}

/** Eén regel herkomst, die elke latere stap toont. */
export function describeExtract(meta: ExtractMeta): string {
  const ageMs = Date.now() - Date.parse(meta.extractedAt);
  const ageHours = Math.round(ageMs / 3600000);
  return (
    `extract: ${meta.itemCount} items uit ${meta.table} @ ${meta.region} ` +
    `(account ${meta.account}), gemaakt ${meta.extractedAt} — ${ageHours} uur geleden`
  );
}
