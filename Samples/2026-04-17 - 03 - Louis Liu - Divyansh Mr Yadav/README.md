# Sample: Louis Liu vs Divyansh Mr Yadav (Round 3)

## Files
- `20260418_234017560_iOS.jpg` — Photo of the handwritten US Chess Official Score Sheet (rotated 90° CCW)
- `2026-04-17 - 03 - Louis Liu - Divyansh Mr Yadav.pgn` — Manually corrected PGN (ground truth)

## Game Summary
- 20-move English Opening (A13), Draw (1/2-1/2)
- Short game ending with a check

## Use in Development

### OCR Accuracy Testing
This is the secondary sample for fuzzy matching validation (Game 2 in the test harness).
Shorter game with fewer moves, useful for quick smoke tests.
Current match rate: ~92%.

### Handwriting Challenges
- Same writer as Game 1, similar handwriting style
- Fewer moves means fewer edge cases, but still exercises common confusions
- Good test for castling recognition (O-O on move 7)

### How to Use
1. Upload the `.jpg` to the app via the upload page
2. Compare the app's recognized moves against the `.pgn` ground truth
3. Quick validation sample — use after engine changes for a fast sanity check
4. After engine changes, re-run `npx tsx web/tests/test-matching.ts` to check regression
