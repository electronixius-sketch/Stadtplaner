# 🏙️ Stadtplaner

Ein 3D-Städtebauspiel für Tablets, inspiriert von *Cities: Skylines*. Es läuft komplett im Browser
(WebGL 2), braucht keine Installation und funktioniert nach dem ersten Laden auch offline.

![Icon](icons/icon-192.png)

## Spielen

**Auf dem Tablet:** Die Seite im Browser öffnen (Safari, Chrome, Edge) und über
*Teilen → Zum Home-Bildschirm* (iPad) bzw. *Menü → App installieren* (Android) als App
hinzufügen. Dann startet das Spiel im Vollbild und läuft offline.

**Lokal am Rechner:** Weil das Spiel ES-Module nutzt, muss es über einen kleinen Webserver
laufen (Öffnen per Doppelklick auf `index.html` geht nicht):

```bash
npm start          # startet einen Server auf http://localhost:8080
# oder ohne npm:
python3 -m http.server 8080
```

Um es vom Rechner aus auf dem Tablet im selben WLAN zu spielen, die IP-Adresse des Rechners
aufrufen, z. B. `http://192.168.1.20:8080`.

**Veröffentlichen mit GitHub Pages:** In den Repository-Einstellungen unter
*Settings → Pages* als Quelle „GitHub Actions“ wählen. Der Workflow
`.github/workflows/pages.yml` veröffentlicht das Spiel bei jedem Push auf `main`
(oder manuell über *Actions → Deploy → Run workflow*). Danach ist es unter
`https://<benutzername>.github.io/<repository>/` erreichbar.

## Features

- **Prozedurale Karten** (128 × 128 Felder) mit Fluss, See, Bergen, Wäldern und einem
  Autobahnanschluss an die Außenwelt – jede Kartennummer ergibt eine andere Landschaft.
- **Straßen** per Fingerzug: Straße, Allee (mit Bäumen und Mittelstreifen), Autobahn.
  Über Wasser entstehen automatisch Brücken. Kreuzungen bekommen Zebrastreifen.
- **Zonen** wie in Cities: Skylines – Wohnen, Gewerbe, Industrie und Büros, teils in
  hoher Dichte. Gebäude wachsen automatisch, werden gebaut (mit Gerüst und Kran) und
  steigen mit Bodenwert, Bildung und Zufriedenheit bis zu 5 Stufen auf.
- **Nachfrage-Balken** (W/G/I/B) wie das RCI-Modell: Arbeitsplätze, Einwohner, Waren und
  Bildung beeinflussen sich gegenseitig.
- **Versorgung**: Strom (Windrad, Kohle, Solar, Müllverbrennung), Wasser und Abwasser.
  Leitungen liegen unter den Straßen – nur verbundene Netze werden versorgt.
- **Dienste** mit Wirkungsradius: Polizei, Feuerwehr, Arztpraxis/Krankenhaus,
  Grundschule/Gymnasium/Universität, Mülldeponie, Parks, Rathaus, Stadion, Fernsehturm.
- **Nahverkehr**: Busdepot und Haltestellen – Busse fahren sichtbar durch die Stadt,
  entlasten die Straßen und bringen Fahrkarteneinnahmen.
- **Verkehrssimulation** mit A*-Wegfindung, Fahrspuren, Stau und Feuerwehreinsätzen.
- **Umwelt**: Bodenwert, Verschmutzung, Lärm, Kriminalität. Bäume filtern Abgase.
- **Brände**, verlassene Gebäude, Pendler, Arbeitslosigkeit.
- **Meilensteine** von „Ackerland“ bis „Megastadt“ schalten neue Gebäude frei und
  bringen Belohnungen.
- **Budget** mit Steuerreglern je Zone, Einnahmen/Ausgaben je Kategorie und Verlaufsdiagrammen.
- **Info-Ansichten** (Bodenwert, Strom, Wasser, Verschmutzung, Lärm, Verkehr, Dienste …)
  färben Stadt und Gelände ein.
- **Zwitscher-Feed** mit Meldungen der Bürger, Warnungen der Stadtverwaltung und einer
  Einführung für die ersten Schritte.
- **Tag-Nacht-Zyklus** mit beleuchteten Fenstern, Straßenlaternen und Leuchtreklamen,
  Echtzeit-Schatten, animiertem Wasser mit weichen Uferlinien, Rauch, Feuer und drehenden Windrädern.
- **Leben in der Stadt**: Autos, Lkw, Busse und Löschfahrzeuge, Fußgänger auf den Gehwegen
  (beim Hineinzoomen) und ziehende Wolken (beim Herauszoomen).
- **Grafikoptionen** (Qualität, Schatten, Fahrzeuganzahl, Tag/Nacht, Symbole, Ton) für ältere Tablets.
- **Rückgängig** für jede Bauaktion, automatisches Speichern, Export/Import von Spielständen.

## Steuerung

| Touch (Tablet) | Aktion |
| --- | --- |
| 1 Finger ziehen | Karte verschieben (ohne Werkzeug) bzw. bauen (mit Werkzeug) |
| 2 Finger | Zoomen (spreizen), Drehen (verdrehen), Verschieben |
| 3 Finger hoch/runter | Kamera neigen (alternativ Knöpfe rechts) |
| Tippen | Gebäude- oder Straßeninfos |
| Gebäude platzieren | Ziehen, dann ✓ (⟳ dreht, ✕ bricht ab) |

| Maus / Tastatur | Aktion |
| --- | --- |
| Linke Taste | Bauen bzw. Karte verschieben |
| Rechte Taste | Drehen und Neigen |
| Mausrad | Zoomen |
| WASD / Pfeile, Q/E, R/F, T/G | Bewegen, Drehen, Zoomen, Neigen |
| Leertaste, 1–3 | Pause, Spieltempo |
| Strg+Z, Esc, B | Rückgängig, Werkzeug abwählen, Abriss |

## Tipps für den Einstieg

1. Baue eine Straße, die an die **Autobahn** anschließt – nur so ziehen Menschen zu.
2. Weise **Wohn-, Gewerbe- und Industriezonen** entlang der Straßen aus (bis 3 Felder tief).
   Halte Industrie wegen der Abgase etwas abseits der Wohngebiete.
3. Baue ein **Windrad** sowie **Wasserpumpe und Abwasserauslass** am Flussufer
   (Abwasser flussabwärts der Pumpe ist realistisch, spielt aber keine Rolle).
4. Beobachte die **Nachfrage-Balken** und das **Budget**.
5. Ab 200 Einwohnern gibt es Polizei, Feuerwehr, Schulen und Busse – Parks und Dienste
   steigern den Bodenwert, dann werden Gebäude größer und wertvoller.

## Technik

- Reines JavaScript (ES-Module), keine Build-Schritte. [three.js](https://threejs.org) r170
  liegt unter `vendor/` (MIT-Lizenz).
- Alle Gebäude, Straßen und Bäume sind prozedural erzeugte Low-Poly-Geometrie; Fenster,
  Nachtbeleuchtung und Info-Ansichten entstehen im Shader. Die Welt wird in 16 × 16-Chunks
  gerendert, Geometrie pro Gebäude zwischengespeichert, Bäume und Fahrzeuge per Instancing.
- Die Simulation (`src/sim.js`, `src/world.js`, `src/traffic.js`) ist unabhängig vom
  Rendering und lässt sich headless testen:

```bash
npm test            # baut eine Teststadt und simuliert 1500 Spieltage
```

### Projektstruktur

```
index.html, css/style.css     Oberfläche
manifest.webmanifest, sw.js   PWA (Installation, Offline)
src/config.js                 Gebäude, Zonen, Kosten, Meilensteine
src/mapgen.js, src/world.js   Karte, Straßennetz, Zonen, Gebäude, Rückgängig
src/sim.js, src/traffic.js    Simulation und Verkehr
src/render/                   3D-Darstellung (Gelände, Chunks, Gebäude, Effekte …)
src/ui.js, src/tools.js       Oberfläche und Bauwerkzeuge
src/input.js, src/camera.js   Touch-/Maus-Steuerung und Kamera
tests/sim-smoke.mjs           Headless-Test der Simulation
```
