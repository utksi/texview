/* ============================================================
   tex.js — lightweight LaTeX renderer
     1. strip comments (% to end of line)
     2. shelf verbatim / listings / math so subsequent transforms ignore them
     3. drop preamble noise (\documentclass, \usepackage, ...)
     4. resolve metadata + \maketitle
     5. process structural environments (itemize, theorem-like, tabular, ...)
     6. process sectioning commands with numbering
     7. process inline commands (\textbf, \emph, \href, \includegraphics, ...)
     8. character substitutions (---, ``, '', \&, \%, ...)
     9. paragraphize
    10. restore shelved blocks (verbatim, math) into real HTML nodes
    11. DOMPurify + inject
    12. KaTeX render on .tex-math
    13. rewrite image srcs via MdvAttachments
   ============================================================ */
(function () {
  'use strict';

  /* Private-Use-Area delimiters for our placeholders (same trick as the
     mdview pipeline — these chars won't appear in real source). */
  const BD = '';  // block delim (math + verbatim block)
  const ID = '';  // inline delim (math inline + \verb)
  const HD = '';  // hold delim (general shelf for tabular, theorem bodies, etc.)
  const BLOCK_RE  = new RegExp(BD + '(\\d+)' + BD, 'g');
  const INLINE_RE = new RegExp(ID + '(\\d+)' + ID, 'g');
  const HOLD_RE   = new RegExp(HD + '(\\d+)' + HD, 'g');

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escAttr(s) {
    return String(s).replace(/[<>"&]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c];
    });
  }
  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
  }

  /* Iteratively apply a replacement until it stops changing — used for
     commands whose argument can contain nested commands (innermost first). */
  function fixpoint(s, fn) {
    let prev;
    do { prev = s; s = fn(s); } while (s !== prev);
    return s;
  }

  /* ---------- main render ---------- */
  function render(src, target) {
    const slots = [];
    const holds = [];
    let s = String(src || '').replace(/\r\n?/g, '\n');

    /* 1. Strip comments. % starts a comment unless preceded by an odd
          number of backslashes. */
    s = s.replace(/(^|[^\\])(\\\\)*%[^\n]*/g, function (m, pre, bs) {
      return pre + (bs || '');
    });

    /* 2. Shelf verbatim and listings blocks BEFORE math extraction. */
    s = s.replace(/\\begin\{(verbatim|lstlisting)\*?\}\n?([\s\S]*?)\n?\\end\{\1\*?\}/g,
      function (m, env, body) {
        const id = slots.length;
        slots.push({ kind: env, body: body });
        return '\n' + BD + id + BD + '\n';
      });
    /* \verb|text| or \verb!text! — pick any non-letter delimiter. */
    s = s.replace(/\\verb\*?([^a-zA-Z\s])([\s\S]*?)\1/g, function (m, d, body) {
      const id = slots.length;
      slots.push({ kind: 'verb', body: body });
      return ID + id + ID;
    });

    /* 3. Shelf math BEFORE structural transforms (KaTeX needs the source
          intact, including underscores and braces). */
    // Display math via amsmath environments — KaTeX understands these,
    // so we pass the whole \begin{...}...\end{...} string straight through.
    const dispEnvs = 'equation|equation\\*|align|align\\*|alignat|alignat\\*|' +
                     'gather|gather\\*|multline|multline\\*|eqnarray|eqnarray\\*|' +
                     'split|cases|aligned|gathered|array|matrix|bmatrix|pmatrix|' +
                     'vmatrix|Bmatrix|Vmatrix|smallmatrix';
    s = s.replace(new RegExp('\\\\begin\\{(' + dispEnvs + ')\\}[\\s\\S]*?\\\\end\\{\\1\\}', 'g'),
      function (m) {
        const id = slots.length;
        slots.push({ kind: 'math-block', body: m });
        return '\n' + BD + id + BD + '\n';
      });
    // \[ ... \]
    s = s.replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, function (m, body) {
      const id = slots.length;
      slots.push({ kind: 'math-block', body: body });
      return '\n' + BD + id + BD + '\n';
    });
    // $$ ... $$
    s = s.replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, function (m, body) {
      const id = slots.length;
      slots.push({ kind: 'math-block', body: body });
      return '\n' + BD + id + BD + '\n';
    });
    // \( ... \)
    s = s.replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, function (m, body) {
      const id = slots.length;
      slots.push({ kind: 'math-inline', body: body });
      return ID + id + ID;
    });
    // $ ... $  (single dollar, single line, avoid currency by requiring
    // a non-space inside and ensuring the closing $ isn't right before a digit)
    s = s.replace(/(^|[^\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g,
      function (m, pre, body) {
        const id = slots.length;
        slots.push({ kind: 'math-inline', body: body });
        return pre + ID + id + ID;
      });

    /* 4. Strip preamble noise. */
    s = s.replace(/\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}/g, '');
    s = s.replace(/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\}/g, '');
    s = s.replace(/\\newcommand\s*\\?\{?[^}]+\}?\s*(?:\[\d+\])?(?:\[[^\]]*\])?\s*\{[\s\S]*?\}\s*/g, '');
    s = s.replace(/\\renewcommand\s*\\?\{?[^}]+\}?\s*(?:\[\d+\])?(?:\[[^\]]*\])?\s*\{[\s\S]*?\}\s*/g, '');
    s = s.replace(/\\newtheorem\s*\{[^}]+\}\s*\{[^}]+\}\s*(?:\[[^\]]*\])?/g, '');
    s = s.replace(/\\theoremstyle\s*\{[^}]+\}/g, '');
    s = s.replace(/\\bibliographystyle\s*\{[^}]+\}/g, '');
    s = s.replace(/\\bibliography\s*\{[^}]+\}/g, '');
    s = s.replace(/\\setcounter\s*\{[^}]+\}\s*\{[^}]+\}/g, '');
    s = s.replace(/\\pagestyle\s*\{[^}]+\}/g, '');
    s = s.replace(/\\thispagestyle\s*\{[^}]+\}/g, '');
    s = s.replace(/\\begin\{document\}/g, '');
    s = s.replace(/\\end\{document\}/g, '');

    /* 5. Title metadata + \maketitle. */
    let title = '', author = '', date = '';
    s = s.replace(/\\title\s*\{([^}]*)\}/g, function (_, t) { title = t.trim(); return ''; });
    s = s.replace(/\\author\s*\{([^}]*)\}/g, function (_, a) { author = a.trim(); return ''; });
    s = s.replace(/\\date\s*\{([^}]*)\}/g, function (_, d) { date = d.trim(); return ''; });
    s = s.replace(/\\maketitle/g, function () {
      if (!title && !author && !date) return '';
      let html = '<div class="tex-titlepage">';
      if (title)  html += '<h1 class="tex-title">' + processInlineText(title)  + '</h1>';
      if (author) html += '<p class="tex-author">' + processInlineText(author) + '</p>';
      if (date)   html += '<p class="tex-date">'   + processInlineText(date)   + '</p>';
      html += '</div>';
      return html;
    });

    /* Resolve simple label / ref mapping. We do a two-pass: first scan to
       collect labels and their section numbers, then a second pass to resolve
       \ref / \eqref. */
    const labelMap = Object.create(null);
    const ctr = { section: 0, subsection: 0, subsubsection: 0, equation: 0 };

    /* 6. Sectioning with numbering. We use a placeholder pass to handle
          numbering atomically (so \ref{} resolves correctly later). */
    function emitHeading(level, starred, label, text) {
      let num = '';
      if (!starred) {
        if (level === 1) { ctr.section++; ctr.subsection = 0; ctr.subsubsection = 0; num = String(ctr.section); }
        else if (level === 2) { ctr.subsection++; ctr.subsubsection = 0; num = ctr.section + '.' + ctr.subsection; }
        else if (level === 3) { ctr.subsubsection++; num = ctr.section + '.' + ctr.subsection + '.' + ctr.subsubsection; }
      }
      if (label) labelMap[label] = num;
      const slug = slugify(text) || ('sec-' + (Math.random()*1e6 | 0));
      const id = slug + (num ? '-' + num.replace(/\./g, '-') : '');
      const numHtml = num ? '<span class="tex-sec-num">' + num + '</span>' : '';
      return '<h' + Math.min(level, 5) + ' id="' + escAttr(id) + '">' +
             numHtml + processInlineText(text) + '</h' + Math.min(level, 5) + '>';
    }

    /* Sectioning: process all levels in a SINGLE pass so they're numbered
       in document order. Each match is `\<level>{...}` optionally followed
       by `\label{...}`. We handle longer names first so e.g.
       `subsubsection` isn't accidentally matched by the `subsection` rule. */
    const sectionRe = /\\(subsubsection|subsection|section|subparagraph|paragraph)(\*?)\s*\{([^}]*)\}(\s*\\label\{([^}]*)\})?/g;
    const sectionLevels = {
      section: 1, subsection: 2, subsubsection: 3,
      paragraph: 4, subparagraph: 5
    };
    s = s.replace(sectionRe, function (_, kind, star, text, _l, label) {
      return emitHeading(sectionLevels[kind], !!star, label || '', text);
    });

    /* 7. Block environments. Run repeatedly so nested envs resolve. */
    s = fixpoint(s, function (s) {
      // itemize / enumerate / description
      s = s.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, function (_, body) {
        return '<ul>' + splitItems(body) + '</ul>';
      });
      s = s.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, function (_, body) {
        return '<ol>' + splitItems(body) + '</ol>';
      });
      s = s.replace(/\\begin\{description\}([\s\S]*?)\\end\{description\}/g, function (_, body) {
        return '<dl>' + splitDescItems(body) + '</dl>';
      });
      // quote / quotation
      s = s.replace(/\\begin\{(quote|quotation)\}([\s\S]*?)\\end\{\1\}/g, function (_, _e, body) {
        return '<blockquote>' + body.trim() + '</blockquote>';
      });
      // center / flushleft / flushright
      s = s.replace(/\\begin\{(center|flushleft|flushright)\}([\s\S]*?)\\end\{\1\}/g,
        function (_, kind, body) {
          return '<div class="tex-' + kind + '">' + body.trim() + '</div>';
        });
      // abstract
      s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, function (_, body) {
        return '<div class="tex-env tex-env--abstract"><span class="tex-env-name">Abstract.</span> ' +
               body.trim() + '</div>';
      });
      // theorem-like
      const thmEnvs = ['theorem', 'lemma', 'corollary', 'proposition', 'definition',
                       'remark', 'example', 'proof', 'claim', 'fact', 'observation',
                       'notation', 'exercise', 'problem', 'solution'];
      thmEnvs.forEach(function (env) {
        const re = new RegExp('\\\\begin\\{' + env + '\\*?\\}(?:\\[([^\\]]*)\\])?([\\s\\S]*?)\\\\end\\{' + env + '\\*?\\}', 'g');
        s = s.replace(re, function (_, label, body) {
          const cls = env === 'proof' || env === 'remark' || env === 'example'
            ? 'tex-env tex-env--' + env
            : 'tex-env tex-env--' + env;
          const labelHtml = label ? ' <span class="tex-env-label">(' + esc(label) + ')</span>' : '';
          const name = env.charAt(0).toUpperCase() + env.slice(1);
          return '<div class="' + cls + '"><span class="tex-env-name">' +
                 name + '.</span>' + labelHtml + ' ' + body.trim() + '</div>';
        });
      });
      // figure: render contents inline (no float)
      s = s.replace(/\\begin\{figure\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{figure\}/g, function (_, body) {
        return '<figure class="tex-figure">' + body.trim() + '</figure>';
      });
      // caption
      s = s.replace(/\\caption\s*\{([^}]*)\}/g, function (_, c) {
        return '<figcaption>' + processInlineText(c) + '</figcaption>';
      });
      // tabular (basic): | column spec | with & cell separators and \\ row separators
      s = s.replace(/\\begin\{tabular\}\s*\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g,
        function (_, spec, body) { return renderTabular(spec, body); });
      return s;
    });

    /* 8. Inline commands. Iteratively for nested args. */
    s = fixpoint(s, function (s) {
      s = s.replace(/\\textbf\s*\{([^{}]*)\}/g,    '<strong>$1</strong>');
      s = s.replace(/\\textit\s*\{([^{}]*)\}/g,    '<em>$1</em>');
      s = s.replace(/\\emph\s*\{([^{}]*)\}/g,      '<em>$1</em>');
      s = s.replace(/\\texttt\s*\{([^{}]*)\}/g,    '<code>$1</code>');
      s = s.replace(/\\textsf\s*\{([^{}]*)\}/g,    '<span class="tex-sf">$1</span>');
      s = s.replace(/\\textsc\s*\{([^{}]*)\}/g,    '<span class="tex-sc">$1</span>');
      s = s.replace(/\\underline\s*\{([^{}]*)\}/g, '<u>$1</u>');
      s = s.replace(/\\sout\s*\{([^{}]*)\}/g,      '<s>$1</s>');
      s = s.replace(/\\textsubscript\s*\{([^{}]*)\}/g,   '<sub>$1</sub>');
      s = s.replace(/\\textsuperscript\s*\{([^{}]*)\}/g, '<sup>$1</sup>');
      s = s.replace(/\\mbox\s*\{([^{}]*)\}/g,      '$1');
      s = s.replace(/\\text\s*\{([^{}]*)\}/g,      '$1');
      // \href{url}{text} and \url{url}
      s = s.replace(/\\href\s*\{([^}]+)\}\s*\{([^{}]+)\}/g, function (_, url, text) {
        return '<a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
      });
      s = s.replace(/\\url\s*\{([^}]+)\}/g, function (_, url) {
        return '<a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>';
      });
      // \includegraphics[opts]{path}
      s = s.replace(/\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g, function (_, opts, path) {
        let width = '';
        if (opts) {
          const m = /width\s*=\s*([0-9.]+)(\\textwidth|\\linewidth|\\columnwidth|em|px|%|in|cm|mm|pt)/.exec(opts);
          if (m) {
            const n = parseFloat(m[1]);
            if (/textwidth|linewidth|columnwidth/.test(m[2])) width = (n * 100) + '%';
            else if (m[2] === '%') width = n + '%';
            else width = m[1] + m[2];
          }
        }
        const style = width ? ' style="max-width:' + width + '"' : '';
        return '<img src="' + escAttr(path) + '" alt=""' + style + '>';
      });
      // \label / \ref / \eqref / \pageref / \autoref
      s = s.replace(/\\label\s*\{([^}]+)\}/g, '');  // (heading labels already captured above)
      s = s.replace(/\\(eqref|ref|autoref|pageref)\s*\{([^}]+)\}/g, function (_, kind, name) {
        const val = labelMap[name];
        if (!val) return '<span class="tex-ref-broken" title="unresolved \\' + kind + '">?</span>';
        return kind === 'eqref' ? '(' + val + ')' : val;
      });
      // \footnote{...} — render inline as a tooltip-style superscript
      s = s.replace(/\\footnote\s*\{([^{}]*)\}/g, function (_, body) {
        return '<sup class="tex-fnref" title="' + escAttr(body.trim()) + '">[?]</sup>';
      });
      // \LaTeX, \TeX, \LaTeXe
      s = s.replace(/\\LaTeXe\b/g, 'LaTeX2ε');
      s = s.replace(/\\LaTeX\b/g, 'LaTeX');
      s = s.replace(/\\TeX\b/g, 'TeX');
      // Misc text commands we just strip while keeping their argument
      s = s.replace(/\\textnormal\s*\{([^{}]*)\}/g, '$1');
      s = s.replace(/\\textrm\s*\{([^{}]*)\}/g, '$1');
      return s;
    });

    /* 9. Character substitutions. We first shelve HTML tags (generated by
          earlier structural transforms) so substitutions like `--` -> en-dash
          don't damage class names like `tex-env--theorem`. */
    const tagShelf = [];
    s = s.replace(/<[^<>]+>/g, function (m) {
      const i = tagShelf.length;
      tagShelf.push(m);
      return HD + i + HD;
    });

    s = s
      .replace(/---/g, '—')          // em dash
      .replace(/(^|[^-])--(?!-)/g, '$1–') // en dash
      .replace(/``/g, '“')           // left double quote
      .replace(/''/g, '”')           // right double quote
      .replace(/(^|[^`])`/g, '$1‘')  // left single quote
      .replace(/'/g, '’')            // right single quote
      // line breaks
      .replace(/\\\\(\[[^\]]*\])?/g, '<br>')
      .replace(/\\newline\b/g, '<br>')
      .replace(/\\par\b/g, '\n\n')
      // tildes / nbsp
      .replace(/~/g, ' ')
      // backslash-escaped specials
      .replace(/\\([&%$#_{}])/g, '$1')
      .replace(/\\textbackslash\b/g, '\\')
      .replace(/\\ldots\b/g, '…')
      .replace(/\\dots\b/g, '…')
      .replace(/\\,/g, ' ')          // thin space
      .replace(/\\;/g, ' ')          // medium space
      .replace(/\\:/g, ' ')          // four-per-em
      .replace(/\\!/g, '')                // negative thin space — drop
      .replace(/\\quad\b/g, ' ')     // em quad
      .replace(/\\qquad\b/g, '  ')
      // hard space
      .replace(/\\ /g, ' ');

    /* Restore HTML tags that were shelved before character substitutions. */
    s = s.replace(HOLD_RE, function (_, idx) { return tagShelf[+idx] || ''; });

    /* 10. Paragraphize: wrap stretches of text separated by blank lines.
           We protect existing block-level tags so they don't get wrapped. */
    s = paragraphize(s);

    /* 11. Restore math + verbatim placeholders. */
    s = s.replace(BLOCK_RE, function (_, idx) {
      const slot = slots[+idx];
      if (!slot) return '';
      if (slot.kind === 'verbatim' || slot.kind === 'lstlisting') {
        return '<pre><code class="tex-verb">' + esc(slot.body) + '</code></pre>';
      }
      if (slot.kind === 'math-block') {
        return '<div class="tex-math" data-display="block">' + esc(slot.body) + '</div>';
      }
      return '';
    });
    s = s.replace(INLINE_RE, function (_, idx) {
      const slot = slots[+idx];
      if (!slot) return '';
      if (slot.kind === 'verb') return '<code class="tex-verb">' + esc(slot.body) + '</code>';
      if (slot.kind === 'math-inline') {
        return '<span class="tex-math" data-display="inline">' + esc(slot.body) + '</span>';
      }
      return '';
    });

    /* 12. Sanitize and inject */
    const sanitized = window.DOMPurify
      ? window.DOMPurify.sanitize(s, PURIFY_CONFIG)
      : s;
    target.innerHTML = sanitized;

    /* 13. KaTeX rendering on .tex-math nodes */
    renderMath(target);
    /* 14. Rewrite image srcs to attachment object-URLs where applicable */
    if (window.MdvAttachments && window.MdvAttachments.rewriteImageSrcs) {
      window.MdvAttachments.rewriteImageSrcs(target);
    }
  }

  /* Split a body containing \item entries into <li> chunks. */
  function splitItems(body) {
    return body.split(/\\item\s*/).slice(1)
      .map(function (chunk) { return '<li>' + chunk.trim() + '</li>'; })
      .join('');
  }

  /* \begin{description}\item[Term] body \end{description} → <dl> */
  function splitDescItems(body) {
    const parts = body.split(/\\item/).slice(1);
    return parts.map(function (chunk) {
      const m = /^\s*\[([^\]]*)\]([\s\S]*)$/.exec(chunk);
      if (m) return '<dt>' + m[1].trim() + '</dt><dd>' + m[2].trim() + '</dd>';
      return '<dd>' + chunk.trim() + '</dd>';
    }).join('');
  }

  /* Render a \begin{tabular}{spec} body \end{tabular} into a table. */
  function renderTabular(spec, body) {
    // alignment from spec — l / c / r — ignore | and p{...} for simplicity
    const aligns = [];
    const re = /([lcr])|p\s*\{[^}]*\}/g;
    let m;
    while ((m = re.exec(spec))) aligns.push(m[1] || 'l');
    const align = function (i) {
      const a = aligns[i] || 'l';
      return a === 'c' ? 'center' : a === 'r' ? 'right' : 'left';
    };
    // rows separated by \\, cells by &
    const rows = body.split(/\\\\(?:\[[^\]]*\])?/).map(function (r) { return r.trim(); })
                     .filter(function (r) { return r && !/^\\h(line|rule)$/.test(r); });
    const out = ['<table class="tex-tabular">'];
    rows.forEach(function (row) {
      // Strip leading \hline and similar from row
      const trimmed = row.replace(/^(\\hline|\\toprule|\\midrule|\\bottomrule|\\hrule)\s*/, '');
      if (!trimmed) return;
      const cells = trimmed.split('&').map(function (c) { return c.trim(); });
      const cellsHtml = cells.map(function (c, i) {
        return '<td style="text-align:' + align(i) + '">' + c + '</td>';
      }).join('');
      out.push('<tr>' + cellsHtml + '</tr>');
    });
    out.push('</table>');
    return out.join('');
  }

  /* Process inline-only text (used inside \title, \section, etc.). */
  function processInlineText(s) {
    return fixpoint(s, function (s) {
      return s
        .replace(/\\textbf\s*\{([^{}]*)\}/g, '<strong>$1</strong>')
        .replace(/\\textit\s*\{([^{}]*)\}/g, '<em>$1</em>')
        .replace(/\\emph\s*\{([^{}]*)\}/g, '<em>$1</em>')
        .replace(/\\texttt\s*\{([^{}]*)\}/g, '<code>$1</code>');
    });
  }

  /* Wrap untagged stretches of text in <p>. We mark known block-level tags
     and split on blank lines. */
  const BLOCK_TAGS = /^\s*<(?:h[1-6]|div|ul|ol|dl|pre|table|figure|blockquote|p|hr|section)\b/i;
  function paragraphize(s) {
    const chunks = s.split(/\n\s*\n+/);
    return chunks.map(function (chunk) {
      const trimmed = chunk.trim();
      if (!trimmed) return '';
      // Already a block element? Don't wrap.
      if (BLOCK_TAGS.test(trimmed)) return trimmed;
      // Inline placeholders (math/verb) get a paragraph wrap too.
      return '<p>' + trimmed + '</p>';
    }).join('\n');
  }

  /* ---------- DOMPurify config ---------- */
  const PURIFY_CONFIG = {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['target', 'data-display', 'id', 'style'],
    ADD_TAGS: ['details', 'summary', 'mark', 'figure', 'figcaption'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange'],
    ALLOW_DATA_ATTR: true
  };
  if (window.DOMPurify) {
    window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  /* ---------- KaTeX rendering ---------- */
  function renderMath(container) {
    if (!window.katex) return;
    const nodes = container.querySelectorAll('.tex-math');
    nodes.forEach(function (node) {
      const display = node.getAttribute('data-display') === 'block';
      const tex = node.textContent;
      try {
        window.katex.render(tex, node, {
          displayMode: display,
          throwOnError: false,
          errorColor: 'var(--color-danger)',
          strict: 'ignore',
          trust: false,
          output: 'html'
        });
      } catch (e) {
        node.textContent = tex;
        node.classList.add('tex-error');
      }
    });
  }

  /* ---------- source map for sync scroll (best-effort) ---------- */
  function buildSourceMap(container) {
    // texview's parser doesn't yet emit source-line attributes; sync scroll
    // will degrade gracefully (no mapping = no smooth sync). Future work.
    const out = [];
    container.querySelectorAll('[data-source-line]').forEach(function (el) {
      const n = parseInt(el.getAttribute('data-source-line'), 10);
      if (Number.isFinite(n)) out.push(el);
    });
    return out;
  }

  /* No mermaid in texview (yet) — but expose a no-op so app.js can call it. */
  function reinitMermaidTheme() { /* no-op */ }

  window.TxvTex = {
    render: render,
    buildSourceMap: buildSourceMap,
    reinitMermaidTheme: reinitMermaidTheme
  };
})();
