# PSO Tool – PDF Checkbox Erkennung

Vollständig lokal im Browser laufendes Tool zur Erkennung von Checkboxen in gescannten PDF-Formularen.

**Kein Server. Kein Upload. Keine Internetverbindung im Betrieb.**

---

## Schnellstart

### 1. Bibliotheken herunterladen (einmalig)

```powershell
.\setup.ps1
```

Das Skript lädt PDF.js, OpenCV.js und Bootstrap in den Ordner `libs/`.
Danach ist das Tool vollständig offline nutzbar.

### 2. Tool starten

`index.html` per Doppelklick im Browser öffnen – fertig.

---

## Bedienung

| Schritt | Aktion |
|---------|--------|
| 1 | PDF-Datei laden (gescanntes Formular) |
| 2 | Template laden (JSON mit Checkbox-Koordinaten) oder Beispiel-Template verwenden |
| 3 | Einstellungen ggf. anpassen |
| 4 | **Analyse starten** |
| 5 | Ergebnis als JSON oder CSV exportieren |

---

## Template-Format

Templates sind JSON-Dateien, die die Positionen der Checkboxen auf dem Formular beschreiben.

```json
{
  "name": "mein-formular",
  "pageWidth": 2480,
  "pageHeight": 3508,
  "fields": [
    {
      "id": "frage_1_ja",
      "label": "Frage 1: Ja",
      "type": "checkbox",
      "page": 1,
      "x": 320,
      "y": 540,
      "width": 55,
      "height": 55
    }
  ]
}
```

### Koordinaten ermitteln

- `pageWidth` / `pageHeight`: Seitengröße des Scan-Bildes in Pixeln
  - A4 bei 300 DPI = 2480 × 3508 px
  - A4 bei 200 DPI = 1654 × 2339 px
- `x`, `y`: Linke obere Ecke der Checkbox in Pixeln (gemessen im Scan-Bild)
- `width`, `height`: Größe der Checkbox in Pixeln

**Tipp:** Öffnen Sie einen Scan in einem Bildeditor (z. B. GIMP, IrfanView) und lesen Sie die Pixelkoordinaten aus der Statusleiste ab.

---

## Ergebnis-Format

```json
{
  "frage_1_ja":   true,
  "frage_1_nein": false,
  "frage_2_ja":   false,
  "frage_2_nein": true
}
```

---

## Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|-------------|---------|
| Render-Skalierung | Höherer Wert = höhere Auflösung, bessere Erkennung | 2.0× |
| Binarisierungs-Threshold | Pixel unter diesem Wert gelten als dunkel | 128 |
| Ankreuz-Schwellwert | Min. Anteil dunkler Pixel für "angekreuzt" | 0.12 (12%) |
| Morphologische Ops | Reduziert Scannerrauschen (Opening empfohlen) | Aus |
| Overlay | Grün/Rot-Overlay über Checkbox-Bereichen | Ein |

---

## Erkannte Ankreuzungsarten

Das System erkennt alle pixelbasierten Markierungen:
- ✓ Häkchen
- ✗ Kreuzmarkierungen
- ■ Ausgefüllte Kästchen
- Kugelschreiber, Filzstift, Bleistift

---

## Projektstruktur

```
pso-tool/
├── index.html                  # Hauptdatei (Doppelklick zum Starten)
├── setup.ps1                   # Bibliotheken herunterladen (einmalig)
│
├── js/
│   ├── app.js                  # Hauptcontroller
│   ├── pdf-handler.js          # PDF.js Integration
│   ├── image-processing.js     # OpenCV.js Pipeline
│   ├── checkbox-detector.js    # Pixel-basierte Erkennung
│   ├── template-manager.js     # Template-Verwaltung
│   └── ui.js                   # DOM / Event-Handling
│
├── libs/                       # Externe Bibliotheken (via setup.ps1)
│   ├── pdf.min.js
│   ├── pdf.worker.min.js
│   ├── opencv.js
│   ├── bootstrap.min.css
│   └── bootstrap.bundle.min.js
│
├── styles/
│   └── app.css
│
└── templates/
    └── example-template.json   # Beispiel-Template
```

---

## Technologien

| Bibliothek | Version | Zweck |
|-----------|---------|-------|
| [PDF.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | PDF rendern im Browser |
| [OpenCV.js](https://docs.opencv.org/4.x/) | 4.8.0 | Bildverarbeitung (WASM) |
| [Bootstrap](https://getbootstrap.com/) | 5.3.2 | UI-Framework |

---

## Fehlerbehebung

**OpenCV lädt nicht / bleibt bei "Initialisiere OpenCV..."**
- Die Datei `libs/opencv.js` ist ~8 MB groß. Bitte warten Sie nach dem ersten Öffnen ca. 5–15 Sekunden.
- Führen Sie `setup.ps1` erneut aus, falls die Datei fehlt.

**PDF wird nicht gerendert**
- Stellen Sie sicher, dass `libs/pdf.min.js` und `libs/pdf.worker.min.js` vorhanden sind.
- Chrome erlaubt das Laden von `file://` Workern. Falls Probleme auftreten, starten Sie Chrome mit `--allow-file-access-from-files`.

**Alle Checkboxen werden als leer erkannt**
- Erhöhen Sie die Render-Skalierung (z. B. auf 3.0).
- Senken Sie den Ankreuz-Schwellwert (z. B. auf 0.06).
- Senken Sie den Binarisierungs-Threshold (z. B. auf 100 für helle Scans).
- Aktivieren Sie das Overlay und prüfen Sie, ob die Template-Koordinaten stimmen.

**Leere Felder werden als angekreuzt erkannt**
- Erhöhen Sie den Ankreuz-Schwellwert (z. B. auf 0.20).
- Erhöhen Sie den Binarisierungs-Threshold (z. B. auf 150).
- Aktivieren Sie Morphologische Ops → Opening.
