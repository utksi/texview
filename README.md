# texview

A browser-only viewer for **lightweight LaTeX** — math notes, problem sets,
derivations. Same shell as [mdview](https://github.com/utksi/mdview): side-by-side
editor + preview, synchronized scrolling, selection mirroring, image attachments,
themes, persistence, no server.

**Live demo:** `https://<user>.github.io/texview/` (after enabling Pages)

## What it renders

- **Math** — `$inline$`, `$$block$$`, `\(…\)`, `\[…\]`, and any `amsmath`
  environment KaTeX supports (`equation`, `align`, `gather`, `multline`,
  `cases`, `matrix`, `aligned`, `split`, …).
- **Sectioning** — `\section`, `\subsection`, `\subsubsection`, `\paragraph`,
  `\subparagraph`. Numbered by default, `*` form unnumbered. `\label{…}` on
  a section and `\ref{…}` / `\eqref{…}` elsewhere resolve to the number.
- **Title block** — `\title{…} \author{…} \date{…} \maketitle`.
- **Lists** — `itemize`, `enumerate`, `description`.
- **Theorem-like environments** — `theorem`, `lemma`, `corollary`,
  `proposition`, `definition`, `remark`, `example`, `proof`, `claim`, `fact`,
  `notation`, `observation`, `exercise`, `problem`, `solution`. Numbered
  block with a label like *Theorem (Pythagoras)*; `proof` gets a ▢ marker.
- **Inline formatting** — `\textbf`, `\textit`, `\emph`, `\texttt`, `\textsf`,
  `\textsc`, `\underline`, `\sout`, `\textsubscript`, `\textsuperscript`.
- **Links** — `\href{url}{text}`, `\url{url}`.
- **Images** — `\includegraphics[width=…]{path}` resolves `./name.ext`
  references to attached images.
- **Verbatim** — `\begin{verbatim}…\end{verbatim}`, `\begin{lstlisting}`,
  and inline `\verb|…|` / `\verb!…!`.
- **Tabular** — basic `\begin{tabular}{lcr}…\end{tabular}` with `&`/`\\`,
  `\hline`/`\toprule`/`\midrule`/`\bottomrule` treated as visual rules.
- **Quotes** — `quote`, `quotation`.
- **Center / flushleft / flushright**.
- **Figures** — `\begin{figure}…\end{figure}` rendered inline (no float).
- **Character substitutions** — `---` → em-dash, `--` → en-dash, `` `` `` /
  `''` smart quotes, `~` nbsp, `\,` `\;` `\:` thin/medium spaces,
  `\\` line break, `\&` `\%` `\$` `\_` `\{` `\}` escaped specials,
  `\ldots` → ellipsis, `\LaTeX` / `\TeX` text marks.

Stripped silently: `\documentclass`, `\usepackage`, `\newcommand`,
`\renewcommand`, `\newtheorem`, `\theoremstyle`, `\begin{document}` /
`\end{document}`, page-style commands, bibliography metadata.

## What it does NOT render

- Bibliographies (`\cite`, `\bibliography`, `\bibitem`).
- Macro expansion (custom `\newcommand` definitions are stripped, not run).
- Float placement, page breaks, microtypography.
- `\input` / `\include` (no file system).
- Most package-specific commands beyond what's listed above.

If you need any of those, use a real LaTeX engine — local TeX Live, Overleaf,
or a WASM build like SwiftLaTeX. texview is a "preview while you type"
tool, not a typesetting engine.

## Features (same as mdview)

- **Four view modes**: split, stacked, source-only, preview-only.
- **Synchronized scrolling** between editor and preview, both directions.
- **Selection mirroring** — selecting text in the preview highlights the
  matching source-line range in the editor (and vice versa).
- **Image attachments** — drag/drop images anywhere, paste screenshots,
  or use the toolbar paperclip. Inserts a `\begin{figure}…\includegraphics{./name.ext}…\end{figure}`
  block at the cursor. On download, the `.tex` and every attachment are
  saved together.
- **Floating "scroll to top"** per pane.
- **Line-number toggle**, **sync-scroll toggle**.
- **Light / dark themes** with auto-follow OS.
- **localStorage persistence** for last document, view mode, theme, etc.
- **Keyboard shortcuts** — press `?`.
- **Mobile-friendly responsive layout**.

## Local use

Static site, no build step:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Or open `index.html` directly (fetch of the welcome doc may fail under
`file://` — there's an inline fallback).

## Deploy on GitHub Pages

1. Push to `main`.
2. Repo Settings → Pages → Source: **GitHub Actions**.
3. The workflow at `.github/workflows/pages.yml` deploys on push to `main`.

## Vendor libraries

| Library      | Purpose                                  |
|--------------|------------------------------------------|
| CodeMirror 5 | source editor (`stex` mode)              |
| KaTeX        | math rendering                           |
| DOMPurify    | HTML sanitization                        |

Total cold-start payload ≈ 250 KB gzipped (no markdown-it, no mermaid).

## License

MIT — see [LICENSE](LICENSE).
