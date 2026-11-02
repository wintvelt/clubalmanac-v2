import { Screen } from "../components/Screen";
import { EmptyState } from "../components/States";
import type { IconName } from "../components/Icon";

// Een bestemming zonder inhoud in WP15a: de leeg-toestand van WP-Design. De
// kop van het scherm (navigatiebalk) blijft staan.
export function PlaceholderScreen({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Screen underHeader>
      <EmptyState icon={icon} title="Komt in een volgende versie" text={text} />
    </Screen>
  );
}
