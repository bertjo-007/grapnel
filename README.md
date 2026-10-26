# Grapnel

Persönliche Lernplattform: Lernsets, Karteikarten, Lernen mit FSRS-Wiederholung, Schreiben,
Multiple Choice, Test, Zuordnen, Gemischt, Import aus Word/Excel/CSV/Text/PDF/Fotos,
Statistik, Export und Geräte-Sync per Geheimcode. Läuft als installierbare PWA, offline,
ohne Konto.

## Starten

```sh
npm install
npx wrangler d1 migrations apply grapnel-sync --local   # einmalig, für den Sync lokal
npm run dev            # http://127.0.0.1:5175
```

Im Dev-Server legt `src/dev/seed.ts` Joshuas Wortliste einmal pro Browser als Set
«Französischwörter» an (alle 726 Paare, auch die doppelten), sofern
`tests/fixtures/private/franzoesischwoerter.docx` da ist. Gibt es das Set schon, passiert nichts.
Browser-Tests starten weiter leer, weil Puppeteer `navigator.webdriver` setzt. Im
Produktions-Build ist nichts davon enthalten.

## Prüfen

```sh
npm test               # Vitest: Kernlogik, Import, Datenbank, Sync (56 Tests)
npm run typecheck
npm run build && npm run preview   # Produktions-Build, http://127.0.0.1:4175
node e2e/import.mjs    # Browser-Tests mit Edge (Dev-Server muss laufen)
node e2e/flow.mjs      # alle Modi, Handy, Dunkelmodus
node e2e/sync.mjs      # zwei Geräte über den lokalen Worker
node e2e/misc.mjs      # Editor, Export, Sprache, alles löschen
node e2e/perf.mjs      # 5000 Karten
node e2e/seed.mjs      # Wortliste aus dem Dev-Seed, Seitenbeschriftung
GRAPNEL_URL=http://127.0.0.1:4175 node e2e/offline.mjs   # gegen den Produktions-Build
```

Die Tests mit Joshuas Wortliste lesen `tests/fixtures/private/franzoesischwoerter.docx`
(nicht im Repo; ohne die Datei werden sie übersprungen). Screenshots landen in `e2e/out/`.

## Aufbau

- `src/core/` ohne DOM, voll getestet: Datenmodell (Dexie), Antwortprüfung, Import,
  Lern-Engine, FSRS-Planung, Statistik, Export, Sync.
- `src/ui/` React-Oberfläche: Seiten, Lernsitzungen, Komponenten, Texte (de, en).
- `worker/` Cloudflare Worker: liefert die App aus und beantwortet `/api/sync/*` mit D1.
- `scripts/` Icon-Erzeugung und Vorlage des Service Workers.

## Entscheide, die nicht im Code stehen

- **Lernstand ist ein Zwischenspeicher.** Er lässt sich jederzeit aus dem Verlauf
  (`reviewLogs`) neu berechnen. Darauf baut der Sync: Verlauf wird vereinigt, Lernstand
  neu berechnet, es gibt keine Konflikte.
- **«Ich hatte recht»** ändert keinen Verlauf, sondern legt einen Korrektur-Eintrag an,
  der den falschen ersetzt (`replaces`).
- **Wiedererkennung verlängert nie.** Multiple Choice, Wahr/Falsch und Zuordnen können
  eine Karte nur zurückholen; Intervalle wachsen nur durch Abruf (Schreiben, Karteikarte).
- **Abwechselnde Zeilen** werden per Viterbi gepaart, damit eingestreute fremde Zeilen
  (z. B. kopierte Quizlet-Oberfläche) die Paarung nicht verschieben.
- **Sync** ist Ende-zu-Ende verschlüsselt (HKDF + AES-GCM). Der Server sieht Raum-ID,
  Hash des Tokens und Chiffre. Der Code steht im QR-Link hinter `#`, geht also nie an den Server.

## Fallstricke

- Service Worker: Version ist ein Hash über Dateiliste und Vorlage, kein Hochzählen nötig.
  Die App lädt nie selbst neu; der Hinweis «Neue Version» bietet es an.
- `vite preview` mit dem Cloudflare-Plugin nach jedem Build neu starten.
- Dev-Server fest auf 127.0.0.1 (Windows lauscht sonst nur auf ::1).
- iPhone: als Home-Bildschirm-App installieren, sonst darf Safari die Daten nach 7 Tagen
  ohne Nutzung löschen. Viewport-Masse kommen aus `src/ui/viewport.ts` (aus dem Jass-Projekt).

## Deploy (nur nach Joshuas OK)

```sh
npx wrangler d1 create grapnel-sync          # ID in wrangler.jsonc eintragen
npx wrangler d1 migrations apply grapnel-sync --remote
npm run deploy                                 # → grapnel.bertjo.workers.dev
```
