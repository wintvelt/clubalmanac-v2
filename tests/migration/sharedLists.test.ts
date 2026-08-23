// WP12 fix-cyclus 2 (R2-3) — één bron voor de tabellen- en FK-set.
//
// Na de B-2-fix bestonden er vier lijsten die hetzelfde beweren en niets van
// elkaar weten: de FK-lijsten in `convex/monitoring.ts` (de autoriteit — dit is
// wat er dagelijks op prod gecontroleerd wordt), `MIGRATION_TABLES` in
// `convex/migration.ts`, `FKS` in `scripts/migrate/types.ts`, en de handmatige
// lijst in de transform-test. De doc-comment op types.ts claimde gelijkheid met
// monitoring.ts die er al niet meer was: `uploadIdempotency` ontbrak.
//
// De eis is niet "één lijst" maar "geen stille afwijking". Twee van die vier
// lijsten móéten handmatig blijven, want ze zijn de oracle waarmee de tooling
// gecontroleerd wordt — de transform gebruikt `FKS` zélf voor zijn
// slotcontrole. Wat hier gepind wordt is dat ze elkaar dekken, zodat een
// wijziging in het schema nergens half kan landen.
//
// Deze tests hebben geen deployment nodig: het zijn uitspraken over lijsten.

import { describe, expect, test } from "vitest";
import { MONITORED_FKS, MONITORED_TABLES } from "../../convex/monitoring";
import { FKS, TABLE_ORDER } from "../../scripts/migrate/types";
import {
  fkKey,
  LOAD_FK_ORACLE,
  MONITORED_FK_ORACLE,
  MONITORED_TABLE_ORACLE,
  NOT_LOADED_BY_IMPORT,
} from "./fkOracle";

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe("de autoriteit: wat WP10 dagelijks controleert", () => {
  test("de FK-set van monitoring.ts is die van de handmatige oracle", () => {
    // De oracle staat in tests/migration/fkOracle.ts en is met de hand uit het
    // schema overgeschreven. Wijkt monitoring.ts af, dan controleert de
    // dagelijkse scan iets anders dan wij denken — en dan klopt ook alles wat
    // de migratie-tooling daarvan afleidt niet meer.
    expect(sorted(MONITORED_FKS.map(fkKey))).toEqual(sorted(MONITORED_FK_ORACLE.map(fkKey)));
  });

  test("de tabellen-set van monitoring.ts is die van de handmatige oracle", () => {
    expect(sorted(MONITORED_TABLES)).toEqual(sorted(MONITORED_TABLE_ORACLE));
  });

  test("elke tabel met een gecontroleerde FK zit in de tabellen-set", () => {
    for (const fk of MONITORED_FKS) {
      expect(MONITORED_TABLES, `${fk.table} wordt gecontroleerd maar niet meegeteld`).toContain(
        fk.table,
      );
    }
  });
});

describe("de tooling volgt de autoriteit", () => {
  test("FKS in de tooling dekt elke gecontroleerde FK op een tabel die de import vult", () => {
    // Wat de transform hier laat glippen, meldt de integriteitsscan vanaf dag
    // één elke ochtend. Andersom net zo goed: een FK die de tooling oplost maar
    // die niemand bewaakt, is een aanname zonder dekking.
    const fromTooling = sorted(
      Object.entries(FKS).flatMap(([table, specs]) =>
        specs.map((spec) => fkKey({ table, field: spec.field, required: spec.required })),
      ),
    );
    const fromAuthority = sorted(
      MONITORED_FKS.filter((fk) => !NOT_LOADED_BY_IMPORT.includes(fk.table)).map(fkKey),
    );
    expect(fromTooling).toEqual(fromAuthority);
  });

  test("de doel-tabel van elke FK klopt met de oracle", () => {
    // Die informatie staat niet in monitoring.ts (een Convex-id draagt zijn
    // eigen tabel), dus hier is de handmatige oracle de enige bron.
    for (const fk of LOAD_FK_ORACLE) {
      const spec = (FKS[fk.table as keyof typeof FKS] ?? []).find((s) => s.field === fk.field);
      expect(spec, `${fk.table}.${fk.field} ontbreekt in de tooling`).toBeDefined();
      expect(spec!.target, `${fk.table}.${fk.field} wijst naar de verkeerde tabel`).toBe(fk.target);
    }
  });

  test("de laadvolgorde bevat elke tabel die de import vult, en verder niets", () => {
    const loaded = MONITORED_TABLE_ORACLE.filter((t) => !NOT_LOADED_BY_IMPORT.includes(t));
    expect(sorted(TABLE_ORDER)).toEqual(sorted(loaded));
  });

  test("een tabel die de import niet vult wordt wél bewaakt", () => {
    // uploadIdempotency: tellen en leegmaken ja, invoegen nee. Het onderscheid
    // is een besluit en moet dus expliciet zijn, geen restpost.
    for (const table of NOT_LOADED_BY_IMPORT) {
      expect(MONITORED_TABLES).toContain(table);
      expect(TABLE_ORDER as readonly string[]).not.toContain(table);
    }
  });
});
