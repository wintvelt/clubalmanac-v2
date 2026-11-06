// Een kleine React-hook-runtime voor tests in Node, zonder renderer. De app
// heeft geen react-test-renderer of DOM; deze runtime vervangt de hooks van
// `react` (via `vi.mock("react", …)`) zodat een hook of een component als
// gewone functie draait.
//
// - useState: één slot per aanroep, op volgorde. Een setter verandert het slot
//   en markeert de runtime als "vuil"; `render()` draait dan opnieuw tot alles
//   stil is.
// - useEffect: draait na een render als de deps veranderd zijn (of zonder
//   deps), met de cleanup van de vorige keer. Zoals React: na de render.
// - createContext/useContext: de standaardwaarde, of wat de test met
//   `provide()` zet.
// - useRef, useMemo, useCallback: genoeg voor componenten in de app.
//
// Bewust beperkt: één boom tegelijk, geen kinderen die zelf renderen. Een
// component geeft een element terug; de test zoekt daarin met `findAll`.

type Deps = readonly unknown[] | undefined;
type Cleanup = void | (() => void);
type Ctx = { readonly __default: unknown; Provider: unknown; Consumer: unknown };

export function createHookRuntime() {
  let slots: unknown[] = [];
  let effectDeps: (Deps | null)[] = [];
  let cleanups: Cleanup[] = [];
  let index = 0;
  let pending: (() => void)[] = [];
  let dirty = false;
  const contexts: Ctx[] = [];
  const provided = new Map<Ctx, unknown>();

  const changed = (prev: Deps | null, next: Deps) =>
    prev === null || prev === undefined || next === undefined || prev.length !== next.length ||
    next.some((d, j) => !Object.is(d, prev[j]));

  const react = {
    createContext<T>(value: T) {
      const ctx: Ctx = { __default: value, Provider: "Provider", Consumer: "Consumer" };
      contexts.push(ctx);
      return ctx;
    },
    useContext(ctx: Ctx) {
      return provided.has(ctx) ? provided.get(ctx) : ctx.__default;
    },
    useState<T>(init: T | (() => T)) {
      const k = index++;
      if (!(k in slots)) slots[k] = typeof init === "function" ? (init as () => T)() : init;
      const set = (u: T | ((prev: T) => T)) => {
        const next = typeof u === "function" ? (u as (prev: T) => T)(slots[k] as T) : u;
        if (!Object.is(next, slots[k])) {
          slots[k] = next;
          dirty = true;
        }
      };
      return [slots[k] as T, set] as const;
    },
    useEffect(fn: () => Cleanup, deps?: Deps) {
      const k = index++;
      const prev = k in effectDeps ? (effectDeps[k] as Deps) : null;
      if (k in effectDeps && !changed(prev, deps)) return;
      effectDeps[k] = deps;
      pending.push(() => {
        const old = cleanups[k];
        if (typeof old === "function") old();
        cleanups[k] = fn();
      });
    },
    useRef<T>(init: T) {
      const k = index++;
      if (!(k in slots)) slots[k] = { current: init };
      return slots[k] as { current: T };
    },
    useMemo<T>(fn: () => T, deps?: Deps) {
      const k = index++;
      const box = slots[k] as { deps: Deps; value: T } | undefined;
      if (box && !changed(box.deps, deps)) return box.value;
      const value = fn();
      slots[k] = { deps, value };
      return value;
    },
    useCallback<T>(fn: T, deps?: Deps) {
      return react.useMemo(() => fn, deps);
    },
  };
  // `import React from "react"` en `import { x } from "react"` allebei.
  const module = { ...react, default: react };

  let current: (() => unknown) | null = null;
  const outputs: unknown[] = [];

  function renderOnce() {
    index = 0;
    dirty = false;
    const out = current!();
    outputs.push(out);
    const run = pending;
    pending = [];
    for (const effect of run) effect();
    return out;
  }

  function rerender<T>(): T {
    let out = renderOnce();
    for (let n = 0; dirty; n++) {
      if (n > 50) throw new Error("hookRuntime: blijft renderen");
      out = renderOnce();
    }
    return out as T;
  }

  return {
    module,
    /** Elke createContext uit de geteste modules, in volgorde. */
    contexts,
    provide(ctx: Ctx, value: unknown) {
      provided.set(ctx, value);
    },
    /** Begin opnieuw met deze functie als "component". */
    render<T>(fn: () => T): T {
      slots = [];
      effectDeps = [];
      cleanups = [];
      pending = [];
      outputs.length = 0;
      current = fn;
      return rerender<T>();
    },
    /** Na een setter of een opgeloste promise: render tot alles stil is. */
    async settle<T>(): Promise<T> {
      for (let n = 0; n < 5; n++) await Promise.resolve();
      return rerender<T>();
    },
    /** Elke uitkomst van elke render sinds `render()`. */
    outputs,
  };
}

export type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type El = { type: unknown; key: string | null; props: Record<string, unknown> };

const isElement = (x: unknown): x is El =>
  typeof x === "object" && x !== null && "type" in x && "props" in x;

/**
 * Alle elementen in een boom die aan `match` voldoen. Een render-prop
 * (`children` als functie) roept de zoeker aan met `renderPropArg`.
 */
export function findAll(tree: unknown, match: (el: El) => boolean, renderPropArg?: unknown): El[] {
  const out: El[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isElement(node)) return;
    if (match(node)) out.push(node);
    const children = node.props.children;
    if (typeof children === "function") walk((children as (a: unknown) => unknown)(renderPropArg));
    else walk(children);
  };
  walk(tree);
  return out;
}
