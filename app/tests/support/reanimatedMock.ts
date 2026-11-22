// Een nep-Reanimated (en nep-worklets) voor tests in Node, zonder native code.
// Elke animatie staat meteen op haar eindstand en roept haar callback meteen
// aan (klaar). Een gedeelde waarde is een gewoon object, vastgehouden met
// `useRef` van de hook-runtime van de test. Namen die hier niet staan (layout-
// animaties zoals `SlideInDown.duration(…)`) geven een ketting die alles
// accepteert. Zo kan een component een animatie krijgen zonder dat de test
// breekt; wat de animatie doet, toetsen audit en gate.

type Refs = { useRef<T>(init: T): { current: T } };

type Shared<T> = { value: T; get(): T; set(v: T | ((prev: T) => T)): void };

function shared<T>(init: T): Shared<T> {
  const box: Shared<T> = {
    value: init,
    get: () => box.value,
    set: (v) => {
      box.value = typeof v === "function" ? (v as (prev: T) => T)(box.value) : v;
    },
  };
  return box;
}

// Een functie die zichzelf teruggeeft, bij elke aanroep en elke eigenschap.
// `then` niet: anders lijkt hij een promise.
function chain(): unknown {
  const self: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === "then" ? undefined : self),
    apply: () => self,
  });
  return self;
}

const ident = <T>(x: T) => x;

const easing = new Proxy(
  {},
  {
    get: (_t, key) => (key === "then" ? undefined : (...args: unknown[]) => (typeof args[0] === "function" ? args[0] : ident)),
  },
);

function instant<T>(to: T, config?: unknown, done?: (finished: boolean) => void): T {
  const cb = typeof config === "function" ? (config as (finished: boolean) => void) : done;
  cb?.(true);
  return to;
}

function interpolate(x: number, input: readonly number[], output: readonly number[]): number {
  const at = (xs: readonly number[], i: number) => xs[i] ?? 0;
  if (input.length < 2) return output[0] ?? x;
  let i = 0;
  while (i < input.length - 2 && x > at(input, i + 1)) i++;
  const [a, b] = [at(input, i), at(input, i + 1)];
  const t = b === a ? 0 : Math.max(0, Math.min(1, (x - a) / (b - a)));
  return at(output, i) + (at(output, i + 1) - at(output, i)) * t;
}

/** De module `react-native-reanimated`. `refs`: de hook-runtime (pas bij gebruik opgevraagd). */
export function reanimatedMock(refs: () => Refs, View: unknown): Record<string, unknown> {
  const api: Record<string, unknown> = {
    View,
    Text: View,
    Image: View,
    ScrollView: View,
    FlatList: View,
    createAnimatedComponent: ident,
    useSharedValue: <T>(init: T) => {
      const r = refs().useRef<Shared<T> | null>(null);
      if (r.current === null) r.current = shared(init);
      return r.current;
    },
    makeMutable: shared,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedProps: (fn: () => unknown) => fn(),
    useDerivedValue: <T>(fn: () => T) => shared(fn()),
    useAnimatedReaction: <T>(prepare: () => T, react: (now: T, prev: T | null) => void) => {
      react(prepare(), null);
    },
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => refs().useRef(null),
    useReducedMotion: () => false,
    withTiming: instant,
    withSpring: instant,
    withDecay: instant,
    withDelay: <T>(_ms: number, v: T) => v,
    withSequence: (...vs: unknown[]) => vs[vs.length - 1],
    withRepeat: ident,
    cancelAnimation: () => {},
    runOnJS: ident,
    runOnUI: ident,
    interpolate,
    interpolateColor: (_x: number, _i: unknown, output: readonly unknown[]) => output[output.length - 1],
    Extrapolation: { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" },
    Easing: easing,
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
  };
  return withFallback({ ...api, default: withFallback(api) });
}

/** De module `react-native-worklets`: alles meteen, op dezelfde thread. */
export function workletsMock(): Record<string, unknown> {
  const now = (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args);
  return withFallback({ scheduleOnRN: now, scheduleOnUI: now, runOnJS: ident, runOnUI: ident });
}

function withFallback(target: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : key === "then" || typeof key === "symbol" ? undefined : chain()),
    has: (t, key) => key in t || (key !== "then" && typeof key !== "symbol"),
  });
}
