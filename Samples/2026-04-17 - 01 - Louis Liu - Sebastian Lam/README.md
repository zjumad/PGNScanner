# Sample: Louis Liu vs Sebastian Lam (Round 1)

## Files
- `20260419_011856959_iOS.jpg` — Photo of the handwritten US Chess Official Score Sheet (rotated 90° CCW)
- `2026-04-17 - 01 - Louis Liu - Sebastian Lam.pgn` — Manually corrected PGN (ground truth)

## Game Summary
- 61-move English Opening (A22), White won (1-0)
- Long endgame with pawn promotions and checkmate

## Use in Development

### OCR Accuracy Testing
This is the primary sample for tuning the fuzzy matching engine (`chessEngine.ts`).
Compare the Vision API's OCR output against the corrected PGN to measure match rate.
The test harness in `web/tests/test-matching.ts` uses this game (Game 1) with
simulated OCR variants per move. Current match rate: ~95%.

### Handwriting Challenges
- Messy youth handwriting with many ambiguous characters
- Common confusions found: N↔M, Q↔O, b↔h, c↔e, d↔a, K↔R
- Score sheet is photographed sideways — tests the Vision API's orientation detection

### How to Use
1. Upload the `.jpg` to the app via the upload page
2. Compare the app's recognized moves against the `.pgn` ground truth
3. Use the review UI to correct any mismatched moves
4. After engine changes, re-run `npx tsx web/tests/test-matching.ts` to check regression
