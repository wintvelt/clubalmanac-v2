# Te testen in de volgende prod-build (TestFlight)

Per werkpakket dat al op `main` staat maar nog niet in een App Store-versie zit. Test op de iPhone met de **prod-build** (`--profile production`), ingelogd met je eigen account. Na de release: het blok weghalen.

## Gedeelde code uit WP42 (Android)

WP42 raakt ook de iPhone: menu's via een gedeelde component, de datumkiezer, het toevoegscherm, neutrale info-teksten, de kaartregel in Privacy en nieuwe meldingen bij een te lang of te groot filmpje. Kort nalopen dat de iPhone hetzelfde doet als in 2.0.2:

1. Foto-menu (Acties in het foto-detail), menu bij een lid (Leden), profielfoto wijzigen, cover weghalen (groepsbeheer): het iOS-blad met dezelfde opties.
2. Een bevestiging (bv. foto verwijderen, en dan Annuleren): de iOS-melding zoals altijd.
3. Filmproject starten (als oprichter, in een testgroep): de datumkiezer werkt; daarna het project sluiten.
4. Foto's en een filmpje toevoegen: datum en plaats komen mee; een filmpje van meer dan 3 minuten geeft de nieuwe melding.
5. Kaart van een album en delen van een foto via het deelmenu.
6. Info → Over en Privacy: neutrale tekst ("de app"), met de regel over de kaart.

## WP46 foto-detail schermvullend (met de Android-fixes van WP46b)

1. Album → foto, rechtop: tik → zwart, alleen de foto (geen kop, infoblok, tabbalk, klok); nog een tik → terug.
2. Vegen in beide standen; dubbeltik zoomt zonder te wisselen; tik en meteen vegen wisselt niet midden in de veeg.
3. Liggend draaien bij een foto verder in het album (bv. de 30e): dezelfde foto staat liggend in beeld; tik toont kop en Acties (Acties hoort bij die foto); terug rechtop: de stand van vóór het draaien.
4. Filmpje: tik verandert niets; volledig scherm van de speler in en uit; terug naar het album: klok en batterij staan er.
5. Terugvegen vanuit schermvullend: album met tabbalk en klok. Mijn foto's: hetzelfde. iPad: niets veranderd.

## WP47 versielabel in Info

1. Prod-build uit TestFlight, bovenaan Instellingen (en in Over de app): "Versie 2.0.3 (n) · TestFlight", met het buildnummer en zonder "dev".
2. Na de release van 2.0.3, de versie uit de App Store: alleen "Versie 2.0.3 (n)", zonder label.
