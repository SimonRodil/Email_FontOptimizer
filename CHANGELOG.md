# Changelog

All notable changes to this project will be documented in this file.

The format is based on *Keep a Changelog* and this project follows *Semantic Versioning* (informally).


## [1.2] - 2026-02-23
### Added
- Improved inline-style detection to cover nested email-HTML patterns where a container (e.g., `<td>`) sets `font-family` and inner elements (`<span>`, `<a>`) override `font-weight` and/or `font-style` without repeating `font-family`.
- New heuristic collector that tracks a running context (`last_family`, `last_weight`, `last_style`) while scanning inline `style="..."` attributes in document order, allowing detection of combinations like:
  - Parent: `font-family: Merriweather; font-weight: 400;`
  - Child: `font-weight: 900;`
  - Nested child: `font-style: italic;`
  Resulting in detection of `Merriweather 900 italic`.

### Fixed
- Missing detection of heavy weights (e.g., `900`) when declared in nested inline styles without `font-family`.
- Missing detection of `italic` variants when `italic` occurs inside a nested structure where weight was overridden in an outer nested element.

### Notes
- This remains a pragmatic heuristic aimed at HTML email markup and does not implement a full CSS cascade/inheritance engine.


## [1.1] - 2026-02-20
### Added
- Inline-style heuristic to detect `font-style: italic` in nested elements (e.g., `<span style="font-style: italic">`) even when `font-family` is only declared on an ancestor element earlier in the HTML.

### Fixed
- Failure to detect italic usage when the inline style containing `font-style: italic` did not also contain `font-family` (common pattern: `<td>` defines family, inner `<span>` toggles italic).

### Notes
- Heuristic uses “last seen” `font-family` from earlier inline styles; designed for typical table-based email templates.


## [1.0] - 2026-02-20
### Added
- Initial release.
- Detects used font variants as triplets `(font-family, font-weight, font-style)` from:
  - Inline `style="..."` attributes containing `font-family`.
  - CSS rules inside `<style>...</style>` excluding `@font-face`.
- Parses `@font-face` blocks and removes unused variants based on detected triplets.
- Adds `mso-font-alt: 'Arial';` **only** inside `@font-face` blocks (if not already present).
- Outputs:
  - `*.processed.html` with updated `<style>` blocks.
  - `*.fonts.log` recording used and removed variants.

### Notes
- Normalizes `font-weight` to numeric hundreds (100–900) and normalizes `font-style` to `normal`/`italic`.
- Ignores generic font families like `serif`, `sans-serif`, etc.
