# Sample: Empty / Reference Score Sheets

## Files
- `USChessOfficialScoreSheet_Empty.webp` — Blank US Chess Official Score Sheet (the format this app targets)
- `USCF_Scoresheet.pdf` — Official USCF tournament score sheet PDF
- `Wikimedia_ChessScoreSheet.jpg` — Polish-style score sheet (different layout)
- `Wikimedia_Capablanca_Scoresheet.jpg` — Historical 1909 Capablanca vs Eisenberg sheet
- `Wikimedia_Fischer_ScoreCard.jpg` — Bobby Fischer's 1970 Olympiad notation (descriptive notation)
- `Wikimedia_1931Tournament_ScoreSheet*.jpg` — 1931 NY International tournament sheets (handwritten)
- Other `.webp`/`.jpg`/`.png` files — Various blank score sheet templates from the web

## Use in Development

### UI Design Reference
Use these images as visual reference when designing the image upload and review UI.
The blank US Chess sheet (`USChessOfficialScoreSheet_Empty.webp`) shows the exact
layout the Vision API prompt describes: header fields at top, 60-row move grid split
into two halves (1-30 left, 31-60 right), result section at bottom.

### Vision API Prompt Tuning
- Compare different score sheet formats to ensure the system prompt covers variations
- The Fischer and 1931 tournament sheets use older notation styles (descriptive vs algebraic)
  — useful for testing edge cases if the app needs to support non-SAN notation in the future
- Different layouts help verify the orientation detection guidance in the prompt

### Testing Without Real Games
Upload any of these blank sheets to the app to test error handling — the Vision API
should return an empty or near-empty move list, and the app should handle it gracefully
without crashing.

### NOT for OCR Accuracy Testing
These sheets have no handwritten moves, so they cannot be used to test fuzzy matching.
Use the game sample folders (with `.pgn` ground truth) for accuracy testing.
