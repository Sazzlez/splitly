# Splitbill 🧾

Ausgaben unter Freunden aufteilen — einfach, modern, ohne Schnickschnack.

## Features
- Namen eintragen und sofort loslegen
- Ausgaben hinzufügen (wer hat bezahlt, wer ist beteiligt)
- Klare Schulden-Übersicht: wer schuldet wem wie viel (ohne Vereinfachung)
- Live-Sync für alle Teilnehmer
- Mobilfreundliches Design

---

## Setup auf Vercel (5 Minuten)

### 1. Repository erstellen
Lade die Dateien in ein GitHub-Repository hoch (oder nutze Vercel CLI).

### 2. Vercel-Projekt erstellen
- Gehe zu [vercel.com](https://vercel.com) → **New Project**
- Repository verbinden
- **Framework Preset**: Other
- Deploy klicken

### 3. Vercel KV Datenbank einrichten
- Im Vercel-Dashboard: **Storage** → **Create Database** → **KV**
- Datenbank benennen (z.B. `splitbill-db`)
- **Connect to Project** → dein Projekt auswählen
- Vercel setzt automatisch die Umgebungsvariablen (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)

### 4. Neu deployen
Nach dem Verbinden der KV-Datenbank einmal neu deployen:
- Vercel Dashboard → **Deployments** → **Redeploy**

### 5. Link teilen
Den Vercel-Link an alle Freunde schicken — fertig! 🎉

---

## Projektstruktur

```
splitbill/
├── index.html          # Frontend (SPA)
├── api/
│   ├── users.js        # GET/POST Benutzer
│   ├── expenses.js     # GET/POST/DELETE Ausgaben
│   └── data.js         # Alle Daten + Schulden-Berechnung
├── package.json        # Abhängigkeiten (@vercel/kv)
├── vercel.json         # Vercel-Konfiguration
└── README.md
```

## Schulden-Berechnung

Die Schulden werden **nicht vereinfacht** (kein Debt Simplification).  
Wenn A dem B 10€ schuldet und B dem A 5€, werden **beide Schulden** einzeln angezeigt.  
So sieht jeder genau, woher seine Schulden kommen.
