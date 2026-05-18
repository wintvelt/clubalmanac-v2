# Convex runtimes: isolate vs `"use node";`

Convex draait functies in twee runtimes naast elkaar. Welke je krijgt = file-level keuze die je per-file vastlegt. WP7-gate 2026-05-18 maakte deze keuze onverwacht zichtbaar; vandaar deze conventie.

## De twee runtimes

| Runtime | Hoe gekozen | Wat werkt | Wat ontbreekt |
|---|---|---|---|
| **Isolate (V8)** | Default — geen directive | Web Standard APIs: `fetch`, `Blob`, `URL`, `Uint8Array`, `TextEncoder`, etc. Snel, schaalt goed, transactioneel-safe | Node-globals: **`Buffer`**, `process` (deels), Node-modules zonder npm-equivalent |
| **Node** | `"use node";` als allereerste regel van de file | Volledige Node-API: `Buffer`, `crypto`, `node:fs` (read-only), npm-libs die Node-internals gebruiken | **Geen mutations of queries** in dezelfde file — alleen `action` en `httpAction` exports toegestaan |

## Wanneer welke

**Default = isolate** voor alle nieuwe files. Het is sneller, transactioneel veiliger, en het overgrote deel van onze logica (mutations + queries) kan alleen daar draaien.

**Switch naar `"use node"` zodra je:**
- een npm-lib gebruikt die `Buffer.from(...)` aanroept (bv. `exif-parser`, `sharp`, veel image/PDF-libs)
- Node-only modules nodig hebt (`node:crypto` voor specifieke HMAC-flows, `node:fs`)
- libs die internals als `Stream`, `EventEmitter` strict-vereisen

**Hoe je 't ontdekt zonder gate**: tijdens deploy-time wint `npx convex dev` niet — code deployt succesvol, faalt pas bij eerste call met `ReferenceError: Buffer is not defined` of vergelijkbaar. **Unit-tests vangen dit niet** want vitest draait in Node + mockt libs vaak op input-type-niveau. Integration-tests op echte deployment zijn de enige betrouwbare check.

## Patroon: gemengde file splitsen

Als je een mutation/query in `foo.ts` hebt én een action die Node nodig heeft, kun je `"use node"` niet toevoegen aan `foo.ts` — Convex verbiedt mengen. Patroon:

1. Maak `convex/fooNode.ts` met `"use node";` als eerste regel
2. Export alleen de Node-action(s) daar
3. Roep cross-file aan via `internal.fooNode.xyz` waar nodig
4. Helpers die geen Node nodig hebben (mutations, queries, isolate-actions) blijven in `foo.ts`

WP7 voorbeeld: `extractMetadata` (heeft Buffer nodig voor `exif-parser`) verhuisd naar [`convex/photoMetadata.ts`](../../convex/photoMetadata.ts). `patchMetadata` (mutation), `getByIdInternal` (query) en `reverseGeocode` (isolate-action — alleen `fetch`) blijven in [`convex/photos.ts`](../../convex/photos.ts). Scheduler-call van `internal.photos.extractMetadata` → `internal.photoMetadata.extractMetadata`. Unit-test-refs mass-renamed.

## Checklist bij nieuwe Node-lib-dependency

Vóór je een npm-lib toevoegt aan een Convex-action:

- [ ] Bevat de lib een `Buffer.from`/`Buffer.alloc`-call? → vereist `"use node"`
- [ ] Importeert het `node:*`-modules? → vereist `"use node"`
- [ ] Heeft het pure JS-vervangers (`exifr` ipv `exif-parser`, `@noble/hashes` ipv `node:crypto`)? → voorkeur isolate-runtime
- [ ] Past het in een bestaande `"use node"`-file? → samenvoegen, anders aparte file maken
- [ ] Wordt dit door een integration-gate gedekt? → zo niet, plannen (zie WP-spec template ops-runbook-impact-veld)

## Trade-offs bij `"use node"`

- ⚠️ Cold-start trager: Node-runtime laadt zwaarder dan isolate
- ⚠️ Per-file scope: geen mutations/queries in zelfde file
- ⚠️ Iets duurder per-call op Convex billing (Node-CPU-quota)
- ✅ Full Node-API beschikbaar: meeste npm-libs werken zonder modificatie
- ✅ Geen polyfill-gymnastics
- ✅ Migratie naar Node-deps die je in v1 had blijft eenvoudig

Voor `extractMetadata`: ~50ms extra cold-start, irrelevant voor onze 16-user-load. Acceptabel.

## Future: alternatieven voor Node-libs

Bij ruimte voor heroverwegen: `exifr` is een browser+Node-compatible alternatief voor `exif-parser` (werkt in isolate). `sharp` heeft geen pure-JS alternatief; `jimp` zou kunnen maar trager. Niet acuut.
