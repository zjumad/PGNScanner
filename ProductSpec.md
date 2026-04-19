# PGN Scanner — Product Specification

## Overview

PGN Scanner is a cross application that converts photographs of handwritten chess score sheets into standard PGN (Portable Game Notation) files.
The app targets players who record games on paper during over-the-board tournaments and want a digital record afterward.
Ultimately this app will be available in the following platforms:
1. Web (Mobile layout)
2. Web (Desktop layout)
3. iOS for iPhone
4. iOS for iPad
5. Android
For now, you will focus on 1# for coding. But when design architecture and code struction, you should keep in mind for this cross platform transplate.

## Sample file
Under the /samples folder, I will provide you the sample files as expected input and output if this app. You should use them to design this app, validate the app, and find opportunities for improvement.

There should be a README.md file in each subfolder there, describe what are the samples there, and how you should use them. When you find a folder without a README.md file in a subfolder under /samples, you should read the existing files, and try to guess the expected use and create a README.md file accordingly.

The sample data will be 3 categories:

### Empty Score Sheets

I will provide you a few empty score sheets. You can expect future input uploaded from users are chess notations written on prints of one of these empty score sheets, or something similar.

You can use these empty score sheets to optimize how to recognize the handwriting on the uploaded pictures.

Please notice some score scheets may have 2 sides. I will provide 2 pictures as sample files, one for each side.

### Well-written notation and its final PGN file

I will provide samples of relatively well-written notation and the final PGN file that I have generated manually for them.

Well-written means there are no or only a few minor typos in the handwritting.

Then PGN file has been verified as reflecting the actual steps during the game.

### ill-written notation and its file PGN file

I will also provide samples in which the notation is ill-written. Ill-writen mains there are major errors in the hand-writing. There might be steps missing. Moves for white and black are flipped in some steps. The last a few steps missing.

But the final PGN file is what I have manually corrected and verified.

You should use these samples to analyze the difference in the handwritten notation vs the final PGN file. Anticipate the manual review and correction steps I will have to do if I were using this app to get the job done. Find opportunities to make it more convenient and efficient for me to do the review and correction steps.

## User Flow

The app follows this workflow:
1. Upload
2. Processing
3. Review
4. Export

### Step 1: Upload

- The user does not have to provide any API Key. This app uses builtin API keys for both providers. The keys are stored in environment variables within the app.
- The user selects a **vision model** from a dropdown on the upload screen:
  - **Gemini 2.5 Flash** (default) — Google's Gemini API
  - **Gemini 3 Flash** — Google's Gemini API
  - **Gemini 3.1 Flash Lite** — Google's Gemini API
  - **Gemini 2.5 Flash Lite** — Google's Gemini API (fastest, cost-efficient)
  - **GPT-5 (GitHub Models)** — OpenAI GPT-5 via GitHub Models inference API
  - **GPT-5 Mini (GitHub Models)** — OpenAI GPT-5 Mini via GitHub Models inference API
- The selected model is persisted in localStorage across sessions.
  
- The user uploads one or more photos of a US Chess Official Score Sheet by:
  - Clicking the upload area to open a file picker (supports selecting multiple files).
  - Dragging and dropping image(s) onto the upload area.
  - Using the device camera (mobile — the file input has `capture="environment"`).
- For **2-sided score sheets**, users can add both pages before scanning. Each page is previewed with a page number badge.
- Supported image formats: JPG, PNG, WEBP (any `image/*` type).
- A preview of the selected image(s) is shown before processing begins. Users click "Scan" to start processing.

#### Image Preprocessing (automatic)

After the user selects images and before OCR processing begins, the app automatically preprocesses each image:

1. **EXIF orientation correction**: Phone photos are often stored sideways with an EXIF orientation tag. The app reads the EXIF metadata and rotates/flips the image to its correct upright orientation using `createImageBitmap` with `imageOrientation: 'from-image'`.
2. **Format normalization**: All images are re-encoded as JPEG (quality 0.92) for consistent format and smaller payload size.
3. The corrected image replaces the original for both:
   - The OCR API call (so the model receives an upright image and doesn't need to detect rotation)
   - The UI display (so the user sees the image in correct orientation)

This means the OCR model no longer needs to detect or report rotation — all grid coordinates are relative to the upright, corrected image.

#### Manual Rotate & Crop (planned)

After uploading and before scanning, the user should be able to manually adjust images:

- **Rotate**: A rotation control allowing 1° incremental adjustments (e.g., a slider or +/− buttons). This applies a real rotation to the image data (not just CSS), so the OCR model and UI both see the rotated version. Useful for slightly tilted photos that aren't perfectly aligned.
- **Crop**: The user can drag to select a rectangular region of the image to crop to. This is useful when:
  - The photo includes extra background beyond the score sheet
  - Only one side of a 2-sided sheet is visible and needs trimming
- After rotating or cropping, the preview updates immediately. The user can undo these adjustments before scanning.
- These adjustments are applied to the preprocessed (EXIF-corrected) image, so they compose correctly.

### Step 2: Processing

- Each image is sent as base64 to the selected Vision API with a detailed system prompt describing the score sheet layout and chess notation rules.
- For **multi-image uploads**, each image is processed sequentially with a progress indicator ("Recognizing image 1 of 2..."). Results are merged by move number — overlapping half-moves keep the higher-confidence version.
- The API returns a JSON response containing:
  - **Header fields**: Event, Date, Round, White, Black, White Elo, Black Elo, Opening, ECO, Result.
  - **Move list**: Each move includes
    - a move number
    - White's move and/or Black's move
    - per-move confidence levels (high / medium / low)
  - **Grid descriptor**: A bounding box for each grid section (left, right, and optionally third) in normalized coordinates (0–1) relative to the preprocessed upright image. The app uses the grid descriptor to compute per-row image crops — the OCR model does not need to return per-move bounding boxes or rotation.
- A spinner with "Recognizing moves…" text is displayed during processing.
- If the API response is truncated JSON, the app attempts automatic repair (closing brackets, stripping incomplete values) before failing.

### Step 3: Review

The review screen uses a **tabbed single-column layout** with three tabs: **Board**, **Game Info**, **Debug**

#### Board Tab
- Displays an interactive chessboard (react-chessboard) showing the position **before** the currently selected move.
- The user can make moves on the board by **clicking** (click-to-select, click-to-place) or **dragging** pieces.
  - Making a move on the board **corrects** the currently selected move to the played move.
  - Legal destination squares are highlighted with green dots when a piece is selected or being dragged.
- Navigation controls (⏮ ◀ ▶ ⏭) allow stepping through moves.
  - Skip the "start" step. By default start at 1 move
  - The text in between should show n.(White|Black), with n indication the move number, and White or Black indicating current step is for White or Black.
- A **Legal Moves Panel** below the board shows all legal moves at the current position, grouped and filterable by piece type (King, Queen, Rook, Bishop, Knight, Pawn). Clicking a legal move corrects/inserts at that position.
- A **move table** displays all validated moves in a 3-column grid (White | Sheet | Black), with:
  - Moves of white on the left, moves of black on the right, and the pictures sheet in between
    - The white move and the black move of the same move should align to the same row. Between is the piece of the picture on notation sheet, cropped to only the 2 cells of the moves.
    - This grid is scollable, diplaying only 3 moves, with the currently focused step in the middle row, one move before and one move after also visible on screen.
    - This grid auto scroll when the currently focus move changes.
    - Allocate the width of the grid to 20%, 60%, 20% for White, Sheet, Black, respectively
    - The cropped image of each row should zoom into the portion of the pictures having the cells for the move.
    - Avoid the two rotate icons on teh header of Sheet column
  - **Color-coded confidence indicators**:
    - 🟢 Green: high confidence (exact match).
    - 🟡 Yellow: medium confidence (fuzzy match, similarity ≥ 0.8).
    - 🟠 Orange: forced/uncertain match (best guess below threshold).
    - 🔵 Blue: user-corrected move.
    - 🔴 Red: invalid move (could not be matched or applied).
    - The texts follwing the indicator should be the legend, not the number of occurrence.
  - **Raw OCR text** shown alongside the matched SAN when they differ.
  - **Inline editing**: No inline edit. I will only edit by moving pieces on the board and selecting from Legal Moves list.
  - **Insert move**: a `+` button between moves allows inserting a missing move. The user selects from legal moves at that position.
  - **Delete move**: a `×` button on each move removes it from the sequence.
- A **PGN preview** panel at the bottom shows the current PGN output in a monospace dark-themed box.
- Clicking a move in the list switches to the Board tab to show the corresponding position.
- An **Export PGN** button downloads the `.pgn` file.

#### Game Info Tab
- A collapsible **Game Info** (header) editor shows all PGN header fields pre-filled from OCR. All fields are editable. The Result field is a dropdown with options: `*`, `1-0`, `0-1`, `½-½`.
- An **Export PGN** button downloads the `.pgn` file.

#### Debug Info tab
- show the text of OCR output
- show the pictures as uploaded

## Move Validation Engine

- All move legality is determined by **chess.js**. The app never manually validates chess rules.
- OCR text is matched to legal moves using a multi-step process:
  1. **Candidate generation** (`generateSanCandidates`): Produces many SAN variants from common handwriting confusions (e.g., `N↔H/M`, `B↔D`, `e↔c`, `1↔l/7`, castling normalization `0-0→O-O`, capture `x` insertion/removal, promotion normalization).
  2. **Similarity scoring**: Each candidate is compared to each legal move using Levenshtein distance. The best scoring legal move is chosen.
  3. **Confidence thresholds**:
     - Exact match (score = 1.0 or case-insensitive = 0.95) → **high** confidence.
     - Score ≥ 0.8 → **medium** confidence.
     - Score ≥ 0.5 → **low** confidence.
     - Below 0.5 with force-match → **low** (forced guess).
- **Validation stops at the first invalid move.** If a move cannot be matched to any legal move, the chain breaks. The user must correct it before subsequent moves can validate.
- **Corrections** trigger full revalidation: when the user corrects a move at index N, the entire game is replayed from move 1 using the original raw OCR text for all moves except the corrected one. This ensures all subsequent moves re-validate against the updated position.
- **Insert** and **Delete** also trigger full revalidation with recalculated move numbers and colors.

### Step 4: Export
Users is able to export the result as PGN files. 

## Move Validation Engine

- All move legality is determined by **chess.js**. The app never manually validates chess rules.
- OCR text is matched to legal moves using a multi-step process:
  1. **Candidate generation** (`generateSanCandidates`): Produces many SAN variants from common handwriting confusions (e.g., `N↔H/M`, `B↔D`, `e↔c`, `1↔l/7`, castling normalization `0-0→O-O`, capture `x` insertion/removal, promotion normalization).
  2. **Similarity scoring**: Each candidate is compared to each legal move using Levenshtein distance. The best scoring legal move is chosen.
  3. **Confidence thresholds**:
     - Exact match (score = 1.0 or case-insensitive = 0.95) → **high** confidence.
     - Score ≥ 0.8 → **medium** confidence.
     - Score ≥ 0.5 → **low** confidence.
     - Below 0.5 with force-match → **low** (forced guess).
- **Validation stops at the first invalid move.** If a move cannot be matched to any legal move, the chain breaks. The user must correct it before subsequent moves can validate.
- **Corrections** trigger full revalidation: when the user corrects a move at index N, the entire game is replayed from move 1 using the original raw OCR text for all moves except the corrected one. This ensures all subsequent moves re-validate against the updated position.
- **Insert** and **Delete** also trigger full revalidation with recalculated move numbers and colors.

## PGN Export

- The exported PGN includes standard header tags (Event, Date, Round, White, Black, Result, and optionally WhiteElo, BlackElo, Opening, ECO).
- Only valid moves are included in the move text.
- Forced/uncertain matches are annotated with comments: `{uncertain: OCR read "raw text"}`.
- The download filename follows the pattern: `{Date} - {Round} - {White} - {Black}.pgn`.

## OCR Export

- No need to give OCR Export button

## Keyboard Navigation

In the review screen, the following keyboard shortcuts are available (when the app has focus):

| Key | Action |
|-----|--------|
| ← / ↑ | Previous move |
| → / ↓ | Next move |
| Home | Go to starting position |
| End | Go to last move |

## API Configuration

- **Gemini models** (default: `gemini-2.5-flash`): Google's Gemini REST API.
  -  Also supports
     - `gemini-3-flash`
     - `gemini-3.1-flash-lite`
     - `gemini-2.5-flash-lite` (fastest/cheapest)
  -  The API key is stored in the `VITE_GEMINI_API_KEY` environment variable (in `web/.env`, gitignored).
- **GitHub Models** (`gpt-5`, `gpt-5-mini`): OpenAI GPT-5 and GPT-5 Mini via GitHub Models inference API at `models.github.ai`. Authenticated with a GitHub Personal Access Token (PAT) with "Models" read permission, stored in the `VITE_GITHUB_TOKEN` environment variable (in `web/.env`, gitignored).
- Both providers use raw `fetch` calls (no SDK).
- Temperature is set to 0 for deterministic output. Max output tokens: 16384.
- No user-facing API key configuration — keys are embedded at build time.
- The user selects the model on the upload screen; the choice is persisted in localStorage (`pgn_scanner_model`).
- If the selected model is not working due to rate limit, automatically try with the next model available on the list
- The model list is ordered as the order they are mentioned in this file.
- **Per-model prompt optimization**: The system prompt is split into a shared base (chess notation rules, sheet layout, response format) and model-specific grid descriptor instructions:
  - **Gemini**: Standard grid instructions; these models handle spatial localization well.
  - **GPT-5 / GPT-5 Mini**: Enhanced instructions with explicit anchor guidance — the grid `y` must start at the first move row (printed number "1"), NOT the header area. Includes a self-check clause and negative examples to prevent the common failure of including the header/event info in the grid bounding box.
- **Grid validation**: The app validates returned grid descriptors before using them (coordinates in [0,1], nonzero dimensions, reasonable row heights, grid starts below header area). Invalid grids are rejected and fall back to per-move bounding boxes.
- **Grid calibration**: Users can manually recalibrate the grid in the Debug tab by clicking two points (top-left of row 1, bottom-right of last row) on the uploaded image. This overrides the model's grid and recomputes all move bounding boxes.

## Improvement Features

### Speculative Continuation Past Errors
- When validation stops (game over but OCR has more moves, or empty OCR entries), remaining raw OCR moves are shown in the move list as **speculative** entries.
- Speculative moves are rendered with a distinct gray/dashed style — they have no board position, no legal alternatives, and cannot be navigated to on the board.
- When the user fixes the error that caused the break, revalidation naturally picks up the speculative tail and validates as many as possible.
- Speculative moves show the raw OCR text so the user can see what the rest of the game looks like before making corrections.

### Correction Summary & Error Navigation
- A **summary bar** at the top of the Moves tab shows legends and counts by category: exact, fuzzy, forced/guess, corrected, invalid, and speculative.
- **Next/Previous error** buttons (▼▲) jump directly to the next move that needs attention. Put a text on the left these button to explain what they do.
- "Needs attention" is defined as: invalid, forced (uncertain guess), fuzzy, or speculative — but NOT moves already manually corrected.

### Undo/Redo for Corrections
- Every correction, insertion, or deletion pushes the previous game state onto an **undo stack**.
- **Ctrl+Z** undoes the last correction; **Ctrl+Shift+Z** redoes.
- The undo/redo stack stores full game state snapshots (moves, corrections, selectedMoveIndex). This is acceptable because chess game states are small.

### Multi-Image Upload
- Users can upload **multiple images** for 2-sided score sheets (or any multi-page game).
- Each image is OCR'd separately, then results are merged by move number (overlapping half-moves keep the higher-confidence version).
- The Image tab shows a **page carousel** with ◀▶ navigation between pages.
- Processing shows progress per image ("Recognizing image 1 of 2...").

### Image Region Highlighting
- The Image tab shows a **move position indicator** displaying the currently selected move's number, color, and approximate grid location (e.g., left column rows 1–25, right column rows 26–50 for a 25-row sheet).
- This is an off-image indicator — no unreliable on-image overlay.

### Smart Suggestions
- When a move **needs attention** (forced, fuzzy, invalid, or speculative), the **Legal Moves Panel** shows 💡 **suggested moves** pinned at the top.
- Suggestions are computed by trying each legal move and checking if the **next raw OCR move** can be matched in the resulting position.
- This helps the user pick the right correction by considering game continuity.

## Technical Constraints

- Single-page React application built with Vite.
- All state lives in `App.tsx` — no state management library.
- TailwindCSS v4 for styling.
- No backend — everything runs client-side. API keys are sent directly from the browser.
- No test framework is currently configured.
