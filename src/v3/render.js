'use strict';
// HTML renderer over the AST. Keeps the 0.2 book design (same CSS and page structure) and adds
// parts, nested sections, tables, footnotes, glossary terms and cross-references.
// Chapter HTML is cached by content hash + global context hash for incremental builds.
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const Blocks = require('./blocks.js');
const MD = require('./markdown.js');
const { hash } = require('./project.js');

const VERSION = '0.3.0';
const esc = E.esc, fa = E.fa;

// Reuse the 0.2 stylesheet exactly: render a minimal 0.2 project once and lift its <style>.
const BASE_CSS = (() => {
  const p = E.emptyProject();
  p.chapters.push({ id: 'c', title: 'c', objectives: [], fichIds: [], blocks: [E.createBlock('paragraph', { id: 'b', text: 'x' })] });
  const html = E.renderBook(p);
  return html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
})();
const EXTRA_CSS = [
  '.part{min-height:120mm;display:flex;flex-direction:column;justify-content:center;border-top:3px solid #277e73;margin-top:12mm}.part h2{font-size:30px}',
  '.toc .tocPart{font-weight:bold;color:#277e73;border-bottom:0;padding-bottom:0}h5{font-size:15px;margin:18px 0 6px}',
  '.tableWrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c9dcd6;padding:6px 9px;text-align:right;vertical-align:top}th{background:#eff6f3}',
  '.fnref{font-size:10px;line-height:0}.footnotes{border-top:1px solid #d7e2de;margin-top:22px;padding-top:8px;font-size:12px;color:#4e636b}.footnotes ol{padding-right:20px}',
  '.term{color:inherit;border-bottom:1px dotted #277e73}.glossary dt{font-weight:bold;margin-top:12px}.glossary dd{margin:0 0 6px}.inlineCite{font-size:11px;color:#60757d}code{font-family:Consolas,monospace;background:#f2f4f3;padding:0 3px}',
  '@media print{.part{break-before:page;break-after:page;min-height:150mm}table{break-inside:avoid}}'
].join('\n');

function textHtml(s) { return esc(s).replace(/\n/g, '<br>'); }

function makeContext(project, globals) {
  const sourceIndex = new Map(project.sources.map((s, i) => [s.id, i + 1]));
  const terms = new Map(project.glossary.terms.map(t => [t.id, t]));
  const ctx = {
    esc, fa, format: project.book.format, text: textHtml,
    usedTerms: globals.usedTerms,
    anchor: node => node.id ? ' id="n-' + esc(node.id) + '"' : '',
    citation(node) {
      const sid = node.attrs && node.attrs.source;
      if (!sid) return '';
      return '<div class="cite"><a href="#ref-' + esc(sid) + '">[' + fa(sourceIndex.get(sid) || 0) + ']</a>' + (node.attrs.locator ? '، ' + esc(node.attrs.locator) : '') + '</div>';
    },
    inline(nodes) {
      return (nodes || []).map(n => {
        switch (n.type) {
          case 'text': return textHtml(n.value);
          case 'code': return '<code>' + esc(n.value) + '</code>';
          case 'emphasis': return '<em>' + ctx.inline(n.children) + '</em>';
          case 'strong': return '<strong>' + ctx.inline(n.children) + '</strong>';
          case 'link': return n.url ? '<a href="' + esc(n.url) + '" rel="noopener noreferrer">' + ctx.inline(n.children) + '</a>' : ctx.inline(n.children);
          case 'cite': return '<span class="inlineCite">[<a href="#ref-' + esc(n.sourceId) + '">' + fa(sourceIndex.get(n.sourceId) || 0) + '</a>' + (n.locator ? '، ' + esc(n.locator) : '') + ']</span>';
          case 'footnote': {
            const k = ctx.footnotes.push(ctx.inline(n.children)), fid = ctx.chapterId + '-' + k;
            return '<sup class="fnref"><a href="#fn-' + esc(fid) + '" id="fnref-' + esc(fid) + '">' + fa(k) + '</a></sup>';
          }
          case 'term': {
            const t = terms.get(n.termId);
            if (t) ctx.usedTerms.add(t.id);
            return t ? '<a class="term" href="#term-' + esc(t.id) + '">' + esc(t.term) + '</a>' : esc(n.termId);
          }
          case 'xref': {
            const info = globals.targets.get(n.target);
            const label = n.children.length ? ctx.inline(n.children) : esc(info ? info.label : n.target);
            return '<a class="xref" href="#' + esc(info ? info.anchor : 'n-' + n.target) + '">' + label + '</a>';
          }
          default: return '';
        }
      }).join('');
    },
    blocks(nodes) { return (nodes || []).map(ctx.block).join(''); },
    block(n) {
      if (n.type === 'paragraph') return '<p' + ctx.anchor(n) + '>' + ctx.inline(n.children) + '</p>' + ctx.citation(n);
      if (n.type === 'list') { const tag = n.ordered ? 'ol' : 'ul'; return '<' + tag + ctx.anchor(n) + '>' + n.items.map(i => '<li>' + ctx.inline(i.children) + '</li>').join('') + '</' + tag + '>' + ctx.citation(n); }
      if (n.type === 'table') return '<div class="tableWrap"' + ctx.anchor(n) + '><table><thead><tr>' + n.header.map(c => '<th>' + ctx.inline(c) + '</th>').join('') + '</tr></thead><tbody>' + n.rows.map(r => '<tr>' + r.map(c => '<td>' + ctx.inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' + ctx.citation(n);
      if (n.type === 'section') { const h = 'h' + (n.depth + 2); return '<section class="sec"' + ctx.anchor(n) + '><' + h + '>' + ctx.inline(n.title) + '</' + h + '>' + ctx.blocks(n.children) + '</section>'; }
      const def = Blocks.get(n.type);
      return def ? def.render.html(n, ctx) : '';
    }
  };
  return ctx;
}

function globalTargets(project, idx) {
  const targets = new Map();
  for (const p of project.parts) targets.set(p.id, { anchor: 'n-' + p.id, label: p.title });
  for (const [id, infos] of idx.ids) {
    const x = infos[0];
    if (x.kind === 'chapter') targets.set(id, { anchor: 'chapter-' + id, label: 'فصل ' + fa(x.number) + (x.title ? ': ' + x.title : '') });
    else if (x.kind === 'section') targets.set(id, { anchor: 'n-' + id, label: x.title || id });
    else if (x.kind === 'source') targets.set(id, { anchor: 'ref-' + id, label: id });
    else if (x.kind !== 'fiche' && x.kind !== 'part') targets.set(id, { anchor: 'n-' + id, label: 'همین بخش' });
  }
  return targets;
}

function renderChapterHtml(project, ch, number, globals) {
  const ctx = makeContext(project, globals);
  ctx.chapterId = ch.entry.id; ctx.footnotes = [];
  const meta = ch.meta, body = ctx.blocks(ch.children);
  const notes = ctx.footnotes.length ? '<section class="footnotes" aria-label="پانویس‌ها"><ol>' + ctx.footnotes.map((h, i) => { const fid = ch.entry.id + '-' + (i + 1); return '<li id="fn-' + esc(fid) + '">' + h + ' <a href="#fnref-' + esc(fid) + '" aria-label="بازگشت">↩</a></li>'; }).join('') + '</ol></section>' : '';
  return '<article class="chapter" id="chapter-' + esc(ch.entry.id) + '"><div class="chapterLabel">فصل ' + fa(number) + '</div><h2>' + esc(meta.title || ch.entry.id) + '</h2>' +
    ((meta.objectives || []).length ? '<div class="objectives"><b>پس از این فصل</b><ul>' + meta.objectives.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul></div>' : '') +
    (project.book.format === 'trainer' ? '<div class="trainerHint">راهنمای اجرا: هدف‌های فصل را با گروه مرور کنید و تمرین‌ها را به موقعیت مخاطبان پیوند دهید.</div>' : '') +
    body + notes + '</article>';
}

function renderBook(project, options) {
  options = options || {};
  const b = project.book, idx = options.index || project.index({ write: options.cache !== false });
  const globals = { targets: globalTargets(project, idx), usedTerms: new Set() };
  const globalKey = hash(JSON.stringify({ v: VERSION, format: b.format, sources: project.sources.map(s => s.id), terms: project.glossary.terms, targets: Array.from(globals.targets).filter(([id, t]) => t.anchor !== 'n-' + id || t.label !== 'همین بخش') }));
  const cacheFile = path.join(project.dir, '.bookengine', 'render-cache.json');
  let cache = {};
  if (options.cache !== false) { try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { cache = {}; } }
  const nextCache = {}, stats = { rendered: 0, cached: 0 };
  const only = options.chapters ? new Set(options.chapters) : null;

  const chapterHtml = [];
  for (const entry of project.chapters) {
    if (only && !only.has(entry.id)) continue;
    const raw = project._chapters.has(entry.id) ? project._chapters.get(entry.id).raw : project._readQuiet(entry.file);
    const key = hash((raw === null ? '' : hash(raw)) + globalKey + entry.number);
    let html, used;
    if (cache[entry.id] && cache[entry.id].key === key) { html = cache[entry.id].html; used = cache[entry.id].terms || []; stats.cached++; }
    else {
      const before = new Set(globals.usedTerms);
      globals.usedTerms = new Set();
      html = renderChapterHtml(project, project.chapter(entry.id), entry.number, globals);
      used = Array.from(globals.usedTerms);
      globals.usedTerms = before;
      stats.rendered++;
    }
    used.forEach(t => globals.usedTerms.add(t));
    nextCache[entry.id] = { key, html, terms: used };
    chapterHtml.push({ entry, html });
  }
  if (options.cache !== false) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(Object.assign({}, cache, nextCache))); } catch (_) { /* optional */ }
  }

  const titleOf = entry => { const info = idx.ids.get(entry.id); return (info && info[0].title) || entry.id; };
  const authors = (b.authors || []).join('، ');
  const cover = '<section class="cover"><div class="eyebrow">نسخه آزمایشی · ' + esc(b.versionLabel) + '</div><h1>' + esc(b.title) + '</h1><div class="subtitle">' + esc(b.subtitle) + '</div><div class="coverMeta"><p>' + esc(authors || 'نام مؤلف ثبت نشده') + '</p><span class="badge">' + esc(E.FORMATS[b.format]) + '</span><p>' + esc(b.audience) + '</p></div></section>';
  const tocItems = [];
  let lastPart = null;
  for (const { entry } of chapterHtml) {
    if (entry.partId && entry.partId !== lastPart) {
      const part = project.parts.find(p => p.id === entry.partId);
      tocItems.push('<li class="tocPart"><a href="#n-' + esc(part.id) + '">' + esc(part.title) + '</a></li>');
    }
    lastPart = entry.partId;
    tocItems.push('<li><a href="#chapter-' + esc(entry.id) + '">' + fa(entry.number) + '. ' + esc(titleOf(entry)) + '</a></li>');
  }
  const terms = project.glossary.terms.filter(t => globals.usedTerms.has(t.id));
  if (terms.length) tocItems.push('<li><a href="#glossary">واژه‌نامه</a></li>');
  if (project.sources.length) tocItems.push('<li><a href="#references">منابع و یادداشت‌های ارجاع</a></li>');
  const warnings = options.warnings || [];
  const toc = '<nav class="toc" aria-label="فهرست کتاب"><h2>فهرست مطالب</h2>' + (b.description ? '<p>' + textHtml(b.description) + '</p>' : '') + '<ol>' + tocItems.join('') + '</ol>' + (warnings.length ? '<div class="reviewNotice">این نسخه نیازمند بازبینی مؤلف است: ' + warnings.map(esc).join('؛ ') + '</div>' : '') + '</nav>';
  let body = '';
  lastPart = null;
  for (const { entry, html } of chapterHtml) {
    if (entry.partId && entry.partId !== lastPart) {
      const pi = project.parts.findIndex(p => p.id === entry.partId), part = project.parts[pi];
      body += '<section class="part" id="n-' + esc(part.id) + '"><div class="chapterLabel">بخش ' + fa(pi + 1) + '</div><h2>' + esc(part.title) + '</h2></section>';
    }
    lastPart = entry.partId;
    body += html;
  }
  const glossary = terms.length ? '<section class="references glossary" id="glossary"><h2>واژه‌نامه</h2><dl>' + terms.map(t => '<dt id="term-' + esc(t.id) + '">' + esc(t.term) + (t.english ? ' <span lang="en" dir="ltr">(' + esc(t.english) + ')</span>' : '') + '</dt><dd>' + textHtml(t.definition || '') + '</dd>').join('') + '</dl></section>' : '';
  const refs = project.sources.length ? '<section class="references" id="references"><h2>منابع و یادداشت‌های ارجاع</h2>' + project.sources.map((s, i) => '<div class="reference" id="ref-' + esc(s.id) + '"><strong>[' + fa(i + 1) + '] ' + esc(s.title) + '</strong><p>' + esc([s.creator, s.year, s.locator].filter(Boolean).join('، ')) + '</p>' + (s.url ? '<div class="sourceUrl"><a href="' + esc(s.url) + '" rel="noopener noreferrer">' + esc(s.url) + '</a></div>' : '') + '<p>' + (s.verified ? 'بررسی منبع توسط مؤلف ثبت شده است.' : 'هنوز توسط مؤلف بررسی نشده است.') + '</p></div>').join('') + '</section>' : '';
  const html = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="BookEngine ' + VERSION + '"><title>' + esc(b.title) + '</title><style>' + BASE_CSS + '\n' + EXTRA_CSS + '</style></head><body><main class="book">' + cover + toc + body + glossary + refs + '</main></body></html>';
  return { html, stats };
}

module.exports = { renderBook, VERSION, BASE_CSS };
