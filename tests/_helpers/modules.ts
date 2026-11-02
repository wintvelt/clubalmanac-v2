/// <reference types="vite/client" />

// WP24 audit R1: convex-test zoekt de functies standaard relatief aan zijn
// eigen plek in node_modules. Een kopie van de repo met een gesymlinkte
// node_modules test dan stilletjes de `convex/`-map van het origineel.
// Deze glob staat naast de tests en wijst altijd naar de `convex/`-map van
// déze checkout. Elke `convexTest(...)` krijgt hem mee als tweede argument;
// tests/writeGates/modulesRoot.test.ts bewaakt dat.
export const modules = import.meta.glob("../../convex/**/*.*s");
