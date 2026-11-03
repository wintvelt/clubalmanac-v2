import type { InfoSlug } from "../lib/infoPages";

// WP15b: de teksten van de Info-pagina's, letterlijk uit
// docs/work-packages/WP15b-info-teksten.md. Wouter keurt ze goed bij de gate.
// Geen user-gegevens: de pagina's zijn ook uitgelogd te lezen (invariant 11).

export type InfoBlock =
  | { kind: "heading"; text: string }
  // `lead`: de schuingedrukte aanloop van een alinea ("Verantwoordelijke.").
  | { kind: "paragraph"; text: string; lead?: string }
  | { kind: "bullets"; items: readonly string[] };

const ABOUT: readonly InfoBlock[] = [
  { kind: "heading", text: "Over deze app" },
  {
    kind: "paragraph",
    text: "Deze app is voor de jaarclub. Voor alle foto's die we in de loop der jaren hebben gemaakt. Een deel is gedigitaliseerd en online gedeeld. Een deel ligt nog op zolders.",
  },
  {
    kind: "paragraph",
    text: "De app blijft bestaan zolang Apple hem in de App Store toelaat. Je kunt de foto's ook bekijken op de website clubalmanac.com.",
  },
  {
    kind: "paragraph",
    text: "De bedoeling is dat de app gratis blijft, maar zonder garanties (zoals in het leven).",
  },
  { kind: "heading", text: "Over de maker" },
  {
    kind: "paragraph",
    text: "Wouter heeft deze app gemaakt. Altijd al een beetje een nerd geweest. Een uit de hand gelopen hobby eigenlijk, net als het penningmeesterschap van de jaarclub.",
  },
  {
    kind: "paragraph",
    text: "Zolang Wouter penningmeester is en bij zinnen blijft, krijgt de app zo nu en dan een update.",
  },
];

const PRIVACY: readonly InfoBlock[] = [
  { kind: "heading", text: "Samenvatting" },
  { kind: "paragraph", text: "Om lid te worden deel je wat gegevens met ons:" },
  {
    kind: "bullets",
    items: [
      "je e-mailadres, om in te loggen",
      "je naam, zodat leden weten wie je bent",
      "de groepen en albums die je maakt",
      "de foto's die je deelt, met de plaats waar ze zijn gemaakt als je toestel die opslaat",
    ],
  },
  {
    kind: "paragraph",
    text: "Je naam en je foto's zien alleen jij, de andere leden van je groepen, en de beheerder van de app (Wouter). Je e-mailadres ziet alleen jij en de beheerder. Verder deelt niemand je gegevens.",
  },
  { kind: "paragraph", text: "Zeg je je lidmaatschap op, dan worden al je gegevens verwijderd." },
  { kind: "heading", text: "De officiële versie" },
  {
    kind: "paragraph",
    lead: "Verantwoordelijke.",
    text: "Inc Management (Pelikaanweg 6, 3762 VB Soest) is verantwoordelijk voor de verwerking van persoonsgegevens zoals beschreven in deze verklaring. Wouter In 't Velt is de functionaris gegevensbescherming. Hij is te bereiken via wouter@clubalmanac.com.",
  },
  { kind: "paragraph", lead: "Welke gegevens.", text: "" },
  {
    kind: "bullets",
    items: [
      "Naam: zoals je hem opgeeft, zodat andere leden je herkennen.",
      "E-mailadres: om in te loggen met een code per e-mail, en om je berichten te sturen, zoals een uitnodiging.",
      "Foto's: die je deelt in de groepen waar je lid van bent.",
      "Locatie van foto's: de GPS-gegevens die je toestel in een foto opslaat, en de plaatsnaam die we daaruit afleiden.",
      "Gebruik: wanneer je de app voor het laatst opende.",
    ],
  },
  {
    kind: "paragraph",
    lead: "Kinderen.",
    text: "De app is niet bedoeld voor kinderen jonger dan 16 jaar zonder toestemming van een ouder of voogd. Denk je dat we zonder die toestemming gegevens van een minderjarige hebben, mail ons dan. Dan verwijderen we ze.",
  },
  {
    kind: "paragraph",
    lead: "Waarvoor.",
    text: "Om je een account te geven, je te laten inloggen, je foto's met je groepen te delen, en je te mailen als dat voor de app nodig is. Er zijn geen advertenties, geen tracking en geen geautomatiseerde besluiten over personen.",
  },
  {
    kind: "paragraph",
    lead: "Hoe lang.",
    text: "Zolang je account bestaat. Verwijder je je account, dan verwijderen we ook je gegevens. Tot dat in de app kan, stuur je een mail.",
  },
  {
    kind: "paragraph",
    lead: "Wie verwerkt je gegevens voor ons.",
    text: "Met deze bedrijven is er een verwerkersovereenkomst of gelden hun standaardvoorwaarden voor verwerkers:",
  },
  {
    kind: "bullets",
    items: [
      "Convex: opslag van alle gegevens en foto's, op servers in Dublin (Ierland, EU).",
      "Clerk: inloggen. Clerk bewaart je e-mailadres en je inlogsessies. Clerk is een Amerikaans bedrijf. De doorgifte buiten de EU valt onder het EU-VS Data Privacy Framework.",
      "Mailjet: het versturen van e-mail, vanuit Frankrijk (EU).",
      "Photon (Komoot): zet de GPS-gegevens van een foto om in een plaatsnaam. Alleen de coördinaten gaan erheen, niet je naam of e-mailadres. Komoot zit in Duitsland (EU).",
    ],
  },
  { kind: "paragraph", lead: "Cookies.", text: "De app gebruikt geen cookies en geen trackers." },
  {
    kind: "paragraph",
    lead: "Inzien, aanpassen of verwijderen.",
    text: "Je hebt het recht je gegevens in te zien, te laten aanpassen of te laten verwijderen. Je naam pas je zelf aan op Profiel. Voor de rest, en voor bezwaar of het overdragen van je gegevens, mail je wouter@clubalmanac.com. We reageren binnen vier weken.",
  },
  {
    kind: "paragraph",
    text: "Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).",
  },
  {
    kind: "paragraph",
    lead: "Beveiliging.",
    text: "We nemen passende maatregelen tegen misbruik, verlies en onbevoegde toegang. Denk je dat er toch iets mis is, mail ons dan.",
  },
];

const TERMS: readonly InfoBlock[] = [
  { kind: "heading", text: "De kleine lettertjes" },
  {
    kind: "paragraph",
    text: "Aan elke verbintenis in het leven zitten helaas voorwaarden vast. Het liefst maken we geen regeltjes, maar er zijn wetten waar iedereen aan moet voldoen. Voordeel: dan is duidelijk wat de afspraken zijn. En nee, hierover valt niet te onderhandelen.",
  },
  { kind: "paragraph", text: "Als je lid wordt van clubalmanac, ga je akkoord met het volgende:" },
  {
    kind: "bullets",
    items: [
      "Je naam en je profielfoto zijn zichtbaar voor de andere leden van je groepen. Je e-mailadres niet.",
      "De foto's die je deelt, blijven van jou.",
      "Je maakt geen inbreuk op de privacy van andere leden.",
    ],
  },
  { kind: "paragraph", text: "Je bent zelf verantwoordelijk voor de foto's die je deelt. Dat betekent:" },
  {
    kind: "bullets",
    items: [
      "Jij hebt de rechten op de foto's, of je mag ze van de eigenaar delen.",
      "Anderen op de foto zijn het eens met wat erop staat. Zo niet, dan kunnen ze jou daarop aanspreken.",
      "De foto's hebben geen illegale of verwerpelijke inhoud.",
    ],
  },
  { kind: "paragraph", text: "Clubalmanac belooft:" },
  {
    kind: "bullets",
    items: [
      "De app zo veel mogelijk in de lucht te houden, en te zorgen dat hij fatsoenlijk werkt.",
      "Je foto's en gegevens veilig op te slaan.",
      "Je foto's en gegevens alleen toegankelijk te maken voor jou en de leden van je groepen.",
      "Dat je op elk moment je account kunt opheffen, en dat dan al je gegevens worden verwijderd.",
      "Dat de app gratis is.",
    ],
  },
  {
    kind: "paragraph",
    text: "Dat is geen garantie. Het kan zijn dat de app een keer niet werkt. We doen ons best, maar je kunt er geen rechten aan ontlenen.",
  },
  { kind: "paragraph", text: "Clubalmanac houdt het recht om:" },
  {
    kind: "bullets",
    items: [
      "Een bedrag voor het lidmaatschap te gaan vragen. Clubalmanac kost geld, en alleen de zon is altijd gratis. Je krijgt dan een redelijke termijn om te beslissen, en je kunt altijd zonder verplichtingen opzeggen.",
      "De werking van de app te veranderen, of er in het ergste geval mee te stoppen. Ook dan krijg je een redelijke termijn.",
      "Je te weren als je je misdraagt, bijvoorbeeld als je je niet aan deze afspraken houdt. Je krijgt dat vooraf te horen, en een redelijke termijn om je spullen op te ruimen. Beroep is niet mogelijk.",
    ],
  },
];

export const INFO_TEXTS: Record<InfoSlug, readonly InfoBlock[]> = {
  over: ABOUT,
  privacy: PRIVACY,
  voorwaarden: TERMS,
};
