import { InModalSheet } from "../../../../../components/useKeyboardReveal";
import { NewFilmProjectScreen } from "../../../../../screens/FilmProjectScreens";

// WP38c (38c-19): "Filmproject starten", modaal in de Home-stack (_layout.tsx),
// zoals Nieuw album. Alleen de oprichter (de backend weigert anderen).
// Besluit 27: met een titelveld; het toetsenbord meet in een modaal blad
// anders (useKeyboardReveal, WP32).
export default function NewFilmProjectRoute() {
  return (
    <InModalSheet>
      <NewFilmProjectScreen />
    </InModalSheet>
  );
}
