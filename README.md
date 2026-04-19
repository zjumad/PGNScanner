# PGN Scanner

A cross-platform app that photographs chess score sheets and converts handwritten notation into PGN files. Currently targeting Web (mobile layout), with plans for desktop web, iOS, and Android.

## Features

- **Score Sheet OCR** — Upload a photo of a US Chess Official Score Sheet and get moves extracted via Google Gemini or OpenAI Vision API
- **Chess Validation** — Every recognized move is validated against chess rules using chess.js, with fuzzy matching for messy handwriting
- **Interactive Review UI** — Chessboard + move list with confidence indicators (green/yellow/red); navigate through moves with keyboard arrows
- **Move Correction** — Double-click any move to edit; see legal move suggestions with autocomplete filtering
- **PGN Export** — Download standard `.pgn` files with full game headers

## Tech Stack

- React + TypeScript + Vite
- TailwindCSS
- chess.js — move validation & legal move generation
- react-chessboard — interactive board display
- Google Gemini / OpenAI Vision API — handwriting recognition

## Getting Started

```bash
cd web
npm install
npm run dev
```

Then open http://localhost:5173

### Setup API Key

1. Get a free API key from [Google AI Studio](https://aistudio.google.com)
2. In the app, select "Gemini (free tier)", paste your key, and click Save
3. Upload a score sheet photo to start scanning

## Usage

1. Set your API key (top right)
2. Upload or photograph a chess score sheet
3. Review recognized moves — confidence indicators show recognition quality
4. Double-click any move to correct it — legal moves are suggested
5. Edit game headers (Event, Players, Date, etc.)
6. Click "Export PGN" to download

## Samples

- `Samples/EmptySheets/` — Blank score sheet template
- `Samples/NotedSheets/` — Example photographed score sheets
- `Samples/PGNs/` — Expected PGN output files
