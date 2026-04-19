# Samples

Sample input/output files for PGN Scanner development, validation, and improvement.

## Categories

### Empty Score Sheets (`EmptySheets/`)

Blank score sheet templates showing the formats users will write on. Use these for:
- UI design reference and Vision API prompt tuning
- Testing graceful handling of uploads with no handwritten moves
- Understanding the layout the OCR system needs to parse

Some sheets have 2 sides — both are provided as separate image files.

### Well-Written Notation

Samples with clean, mostly legible handwriting and only minor ambiguities. The PGN file has been manually verified as ground truth.

| Folder | Game | Moves | Result |
|--------|------|-------|--------|
| `2026-03-28 - 01 - Anirudh Rengarajan - Louis Liu.pgn` | French Defense: Queen's Knight (C00) | 38 | 1-0 |
| `2026-03-28 - 02 - Louis Liu - Vyoam Pottavathini.pgn` | English Opening: Reversed Closed Sicilian (A25) | 30 | 1-0 |
| `2026-03-28 - 04 - Seojoon Oh - Louis Liu/` | French Defense: Advance Variation (C02) | 45 | ½-½ |
| `2026-03-28 - 05 - Louis Liu - Advik Mazari/` | English Opening: Reversed Closed Sicilian (A25) | 29 | 0-1 |
| `2026-04-17 - 01 - Louis Liu - Sebastian Lam/` | English Opening: Carls-Bremen System (A22) | 61 | 1-0 |
| `2026-04-17 - 03 - Louis Liu - Divyansh Mr Yadav/` | English Opening: Agincourt Defense (A13) | 20 | ½-½ |

> **Note:** The first two games (`2026-03-28 - 01`, `2026-03-28 - 02`) are standalone `.pgn` files without score sheet images. They can be used for PGN export validation but not OCR testing.

Use these for OCR accuracy testing and fuzzy matching engine tuning.

### Ill-Written Notation

Samples with major handwriting errors — missing steps, swapped white/black moves, illegible characters, or missing final moves. The PGN file has been manually corrected and verified.

| Folder | Game | Moves | Result |
|--------|------|-------|--------|
| `2026-03-28 - 03 - Suryen Charuvil Vinu - Louis Liu/` | French Defense: Advance Variation (C02) | 51 | 1-0 |
| `2026-04-17 - 02 - Shirley Wang - Louis Liu/` | French Defense: Advance Variation, Nimzowitsch System (C02) | 35 | 0-1 |

Use these to analyze the gap between raw OCR output and the correct PGN, anticipate user correction workflows, and find opportunities to make the review/correction UI more efficient.

### Multi-Image (2-Sided Sheets)

| Folder | Pages | Notes |
|--------|-------|-------|
| `2026-03-28 - 03 - Suryen Charuvil Vinu - Louis Liu/` | 2 | Only sample with a 2-sided sheet; tests multi-image upload and page merging |

## Folder Convention

Each game folder contains:
- One or more `.jpg` images — photos of the handwritten score sheet
- One `.pgn` file — manually corrected ground truth
- `README.md` — describes the sample and its intended use
