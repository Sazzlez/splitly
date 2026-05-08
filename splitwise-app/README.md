# Splitly – Ausgaben-Splitter

Eine moderne Web-App zum Aufteilen von Gruppenausgaben. Gebaut mit Next.js, gespeichert in Google Sheets, gehostet auf Vercel.

---

## 🗂 Google Sheet aufbauen

Erstelle ein neues Google Sheet und lege **zwei Tabellenblätter** (Tabs) an:

### Blatt 1: `Users`
| A | B | C |
|---|---|---|
| id | name | passwordHash |
| *(Daten werden automatisch eingefügt)* | | |

### Blatt 2: `Expenses`
| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| id | description | amount | paidBy | date | participants | createdBy |
| *(Daten werden automatisch eingefügt)* | | | | | | |

**Wichtig:** Die erste Zeile jedes Blatts muss die Spaltenüberschriften enthalten (genau wie oben), die App schreibt ab Zeile 2.

---

## 🔑 Google Service Account einrichten

1. Gehe zu [console.cloud.google.com](https://console.cloud.google.com)
2. Neues Projekt erstellen (oder bestehendes wählen)
3. **APIs & Services → Bibliothek → „Google Sheets API" aktivieren**
4. **APIs & Services → Anmeldedaten → Anmeldedaten erstellen → Dienstkonto**
   - Name: `splitly-sheets`
   - Rolle: keine nötig, einfach fortfahren
5. Auf das erstellte Dienstkonto klicken → **Schlüssel → Schlüssel hinzufügen → JSON**
   - Die heruntergeladene `.json`-Datei enthält deinen Service Account
6. Öffne dein Google Sheet → **Teilen** → die E-Mail-Adresse des Dienstkontos (endet auf `@...iam.gserviceaccount.com`) als **Bearbeiter** hinzufügen

---

## 🚀 Lokal starten

```bash
npm install
cp .env.local.example .env.local
# .env.local mit deinen Werten füllen (siehe unten)
npm run dev
```

---

## ⚙️ Umgebungsvariablen

### `GOOGLE_SHEET_ID`
Die ID deines Google Sheets. Zu finden in der URL:
```
https://docs.google.com/spreadsheets/d/HIER_STEHT_DIE_ID/edit
```

### `GOOGLE_SERVICE_ACCOUNT_JSON`
Den **gesamten Inhalt** der heruntergeladenen JSON-Datei als **eine Zeile** einfügen.

Beispiel (auf einer Zeile):
```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"mein-projekt","private_key_id":"abc123","private_key":"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n","client_email":"splitly-sheets@mein-projekt.iam.gserviceaccount.com",...}
```

**Tipp:** Im Terminal einzeilig umwandeln:
```bash
cat dein-service-account.json | tr -d '\n'
```

### `JWT_SECRET`
Ein langer, zufälliger String. Generieren mit:
```bash
openssl rand -hex 32
```

---

## 🌐 Auf Vercel deployen

1. Projekt auf GitHub pushen:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN_USERNAME/splitly.git
git push -u origin main
```

2. Auf [vercel.com](https://vercel.com) einloggen → **New Project** → GitHub-Repo importieren

3. **Environment Variables** in Vercel setzen:
   - Gehe zu: Project → Settings → Environment Variables
   - Füge die drei Variablen hinzu:
     - `GOOGLE_SHEET_ID` → deine Sheet-ID
     - `GOOGLE_SERVICE_ACCOUNT_JSON` → den gesamten JSON-Inhalt (als eine Zeile)
     - `JWT_SECRET` → dein zufälliger String

4. **Deploy** klicken – fertig! ✅

---

## 🔒 Sicherheitshinweise

- Die `.env.local` Datei **niemals** in Git committen (ist in `.gitignore` ausgeschlossen)
- Den `JWT_SECRET` regelmäßig rotieren falls nötig
- Das Service Account JSON nur für dieses Sheet freigeben

---

## 📱 Features

- **Login/Registrierung** – Benutzer anlegen und anmelden
- **Ausgabe hinzufügen** – Betrag, Beschreibung, Bezahler, Aufteilung in %
- **Aktivität** – Alle Ausgaben chronologisch
- **Schulden** – Genaue Übersicht wer wem wieviel schuldet (ohne Vereinfachung)
