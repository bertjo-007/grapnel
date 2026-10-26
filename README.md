# Grapnel

Lernplattform für Vokabeln und alles andere, das man auswendig lernen muss: Lernsets,
Karteikarten, Lernen mit intelligenter Wiederholung, Schreiben, Multiple Choice, Test,
Zuordnen und Gemischt. Läuft im Browser und offline, ohne Konto.

**App öffnen: <https://bertjo-007.github.io/grapnel/>**

## So bekommst du die App

Es gibt nichts herunterzuladen. Öffne den Link oben, und Grapnel läuft. Für den Alltag
installierst du die App, dann startet sie wie jede andere App und funktioniert auch ohne Internet:

- **iPhone/iPad:** Link in Safari öffnen, Teilen-Knopf, «Zum Home-Bildschirm».
  Wichtig: Ohne Installation darf Safari die Daten nach 7 Tagen ohne Nutzung löschen.
- **Android:** Link in Chrome öffnen, Menü (⋮), «App installieren».
- **Computer:** Link in Chrome oder Edge öffnen, Installieren-Symbol in der Adresszeile.

Beim ersten Öffnen legt Grapnel sechs Französisch-Sets an: «Französischwörter» und die
Kapitel 1, 6, 7, 11 und 19 aus dem Langenscheidt-Grundwortschatz (zusammen 1915 Karten).
Sets, die du löschst, kommen nicht wieder. Eigene Listen holst du über «Importieren» aus
Word, Excel (.xlsx), CSV, Text, PDF oder Fotos.

## Deine Daten

Alles bleibt auf deinem Gerät: Sets, Lernstand und Einstellungen liegen im Browser und
werden nirgends hochgeladen. Darum gibt es auch keinen Abgleich zwischen Handy und Computer.
Sichere deine Sets ab und zu über «Einstellungen → Exportieren». Wer den Browserspeicher
löscht, löscht auch Grapnel.

---

## Für Entwickler

```sh
npm ci
npm run dev            # http://127.0.0.1:5175
```

Die Startsets liegen in `public/startsets/` und werden von `src/startsets.ts` beim ersten
Öffnen über den normalen Import angelegt, jedes einmal pro Browser:

- `franzoesischwoerter.docx`: Quizlet-Kopie, abwechselnd ein Absatz Französisch, einer Deutsch.
  726 Paare, auch die doppelten; die drei kopierten Quizlet-Zeilen fallen weg.
- `langenscheidt.json`: fünf Kapitel aus dem Langenscheidt-Grundwortschatz (1189 Karten),
  umgewandelt aus alten `.xls`-Dateien, weil der Import nur `.xlsx` liest. Spalte D Französisch,
  E Deutsch, G Bemerkung (Info), F Wortart (Notiz); Abschnitte wie «1.3 Aussehen» sind Schlagwörter.

Browser-Tests starten leer, weil Puppeteer `navigator.webdriver` setzt.

### Zwei Ziele

| | GitHub Pages | Cloudflare |
|---|---|---|
| Build | `npm run build:pages` → `dist/pages` | `npm run build` → `dist/client` |
| Adresse | `/grapnel/` | `/` |
| Geräte-Sync | ausgeblendet (kein Server) | per Geheimcode über Worker + D1 |
| Veröffentlichen | automatisch bei jedem Push auf `main` (`.github/workflows/pages.yml`) | `npm run deploy` |

Für Cloudflare einmalig: `npx wrangler d1 create grapnel-sync`, ID in `wrangler.jsonc`,
`npx wrangler d1 migrations apply grapnel-sync --remote`. Lokal braucht der Sync
`npx wrangler d1 migrations apply grapnel-sync --local`.

### Prüfen

```sh
npm test               # Vitest: Kernlogik, Import, Datenbank, Sync
npm run typecheck
node e2e/import.mjs    # Browser-Tests mit Edge (Dev-Server muss laufen)
node e2e/flow.mjs      # alle Modi, Handy, Dunkelmodus
node e2e/sync.mjs      # zwei Geräte über den lokalen Worker
node e2e/misc.mjs      # Editor, Export, Sprache, alles löschen
node e2e/perf.mjs      # 5000 Karten
node e2e/seed.mjs      # Startsets im Dev-Server, Seitenbeschriftung
npm run build:pages && npm run preview:pages   # dann:
node e2e/pages.mjs     # Pages-Build: Startsets, kein Sync, Unterseiten, offline
GRAPNEL_URL=https://bertjo-007.github.io/grapnel node e2e/pages.mjs   # die echte Seite
```

Screenshots landen in `e2e/out/`.

### Aufbau

- `src/core/` ohne DOM, voll getestet: Datenmodell (Dexie), Antwortprüfung, Import,
  Lern-Engine, FSRS-Planung, Statistik, Export, Sync.
- `src/ui/` React-Oberfläche: Seiten, Lernsitzungen, Komponenten, Texte (de, en).
- `worker/` Cloudflare Worker: liefert die App aus und beantwortet `/api/sync/*` mit D1.
- `scripts/` Icon-Erzeugung und Vorlage des Service Workers.

### Entscheide, die nicht im Code stehen

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

### Fallstricke

- Service Worker: Version ist ein Hash über Dateiliste und Vorlage, kein Hochzählen nötig.
  Die App lädt nie selbst neu; der Hinweis «Neue Version» bietet es an.
- Alle Pfade hängen an `import.meta.env.BASE_URL` (Router, Service Worker, Startsets), das
  Manifest nutzt relative Pfade. Absolute Pfade wie `/sw.js` brechen GitHub Pages.
- GitHub Pages liefert Unterseiten über `404.html` (Kopie von `index.html`) mit Status 404 aus.
- `vite preview` nach jedem Build neu starten.
- Dev-Server fest auf 127.0.0.1 (Windows lauscht sonst nur auf ::1).
- Viewport-Masse fürs iPhone kommen aus `src/ui/viewport.ts`.
