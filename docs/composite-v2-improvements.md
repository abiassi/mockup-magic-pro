# Composite v2 — Improvement Roadmap

## Bug Fixes

### 1. Composite results not rehydrated on refresh
**Severity:** High — users lose their composite gallery on every page reload.
**Root cause:** `compositeResults` state is initialized empty and never populated from IndexedDB on init. Only `results` is loaded.
**Fix:** In the init `useEffect`, filter loaded results by `variantType === "composite"` and seed `compositeResults`.

### 2. `processMultipleBaseFiles` stale closure on aspect ratio detection
**Severity:** Low — causes redundant aspect ratio detection but no incorrect behavior.
**Root cause:** All FileReader callbacks capture the same closure where `compositeBaseQueue.length === 0`. When dropping N files simultaneously, all N callbacks see length 0 and all trigger detection.
**Fix:** Use a `let` flag scoped outside the `forEach` loop. First file sets it to `true`, rest skip.

### 3. "Generate Now" silently ignores queue photos after the first
**Severity:** Medium — confusing UX when queue has multiple photos.
**Root cause:** `handleCompositeGenerate` hardcodes `bases[0]`.
**Fix:** Either iterate all bases (making it a mini-batch), or change the button label to "Generate from first photo" when queue > 1, nudging users toward "Run Batch" instead.

## UX Improvements

### 4. No batch cancellation
**Severity:** Medium — a 30-draft batch takes minutes with no escape hatch.
**Fix:** Add a `useRef<boolean>` abort flag. Check it between jobs in `handleBatchComposite`. Show a "Cancel" button while batch is running that sets the flag.

### 5. Native `prompt()` for artwork naming
**Severity:** Low — functional but jarring.
**Fix:** Replace with an inline text input that appears when "Save to Library" is clicked. Auto-populate with the source filename if available, fall back to "Artwork N".

### 6. No cost estimate on batch button
**Severity:** Low — nice-to-have transparency.
**Fix:** Add subtitle text below the batch button: `~$X.XX estimated (N × $0.134)`. For upscale, show `$0.24` per item. Costs are static per the Gemini pricing model.

### 7. Full base64 duplicated in every composite result
**Severity:** High at scale — 30 drafts from 3 bases × 2 artworks duplicates ~150MB of base64.
**Fix:** Create a `composite-sources` IndexedDB store keyed by content hash (first 32 chars of base64 + length). Store a reference ID in `compositeBaseUrl`/`compositeArtworkUrl` instead of the full string. Resolve on read. This is the most invasive change — do last.

## Suggested Order

| Priority | Item | Effort |
|----------|------|--------|
| 1 | #1 Rehydrate composite results | 5 min |
| 2 | #2 Stale closure fix | 5 min |
| 3 | #3 Generate Now vs batch clarity | 10 min |
| 4 | #4 Batch cancellation | 15 min |
| 5 | #5 Inline artwork naming | 10 min |
| 6 | #6 Cost estimate display | 5 min |
| 7 | #7 Deduplicated source storage | 45 min |
