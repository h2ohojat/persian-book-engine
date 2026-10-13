'use strict';
// Three-layer validation: schema (in Project), references (resolver), content rules (warnings).
// Every finding is machine-readable: {severity, code, file, line, nodeId, message, hint}.
const Schema = require('./schema.js');
const Blocks = require('./blocks.js');
const MD = require('./markdown.js');
const { walk, walkInline, inlineOf, nodeText } = require('./project.js');

const norm = t => String(t).normalize('NFC').replace(/\s+/g, ' ').trim();
const PLACEHOLDER = /^(?:متن تازه|متن فصل را اینجا بنویسید|عنوان فصل|TODO)$/;

function suggest(id, ids) {
  let best = null, score = 3;
  for (const cand of ids) {
    const d = distance(id, cand);
    if (d < score) { score = d; best = cand; }
  }
  return best ? 'شاید ' + best : undefined;
}
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function wordCount(ch) {
  let n = 0;
  walk(ch.children, node => {
    if (['paragraph', 'list', 'table', 'section'].includes(node.type)) n += nodeText(node).split(/\s+/).filter(Boolean).length;
    for (const slot of Object.values(node.slots || {})) n += MD.plain(slot.children).split(/\s+/).filter(Boolean).length;
  });
  return n;
}

function validate(project, options) {
  options = options || {};
  const out = [];
  const report = (severity, code, message, where, hint) => out.push(Object.assign({ severity, code, file: where.file, line: where.line == null ? null : where.line, message }, where.nodeId ? { nodeId: where.nodeId } : {}, hint ? { hint } : {}));
  for (const p of project.problems) out.push(p);

  const b = project.book || {};
  const sources = new Map(project.sources.map(s => [s.id, s]));
  const fiches = new Map(project.fiches.map(f => [f.id, f]));
  const terms = new Map(project.glossary.terms.map(t => [t.id, t]));

  // Outline integrity.
  const seenFiles = new Set(), seenChapters = new Set();
  for (const c of project.chapters) {
    if (seenChapters.has(c.id)) report('error', 'outline.duplicate-chapter', 'شناسهٔ فصل «' + c.id + '» تکراری است.', { file: 'outline.yaml' });
    if (seenFiles.has(c.file)) report('error', 'outline.duplicate-file', 'فایل «' + c.file + '» دو بار در outline آمده است.', { file: 'outline.yaml' });
    seenChapters.add(c.id); seenFiles.add(c.file);
    if (c.status === 'approved' && !c.approvedBy) report('warning', 'review.approval-unsigned', 'فصل «' + c.id + '» تأییدشده است اما approvedBy ندارد؛ تأیید باید توسط مؤلف ثبت شود.', { file: 'outline.yaml' });
  }

  // Sources, fiches, glossary.
  const dupCheck = (list, file, label) => {
    const seen = new Set();
    for (const x of list) { if (seen.has(x.id)) report('error', 'id.duplicate', label + ' «' + x.id + '» تکراری است.', { file, line: x.line }); seen.add(x.id); }
  };
  dupCheck(project.sources, 'sources/sources.json', 'منبع');
  dupCheck(project.fiches, 'fiches/fiches.jsonl', 'فیش');
  dupCheck(project.glossary.terms, 'memory/glossary.yaml', 'اصطلاح');
  for (const s of project.sources) {
    if (!s.verified) report('warning', 'review.source-unverified', 'منبع «' + s.title + '» هنوز توسط مؤلف بررسی نشده است.', { file: 'sources/sources.json', nodeId: s.id });
    if (s.verified && !s.verifiedBy) report('warning', 'review.source-unsigned', 'منبع «' + s.id + '» verified است اما verifiedBy ندارد.', { file: 'sources/sources.json', nodeId: s.id });
  }
  for (const f of project.fiches) {
    const where = { file: 'fiches/fiches.jsonl', line: f.line, nodeId: f.id };
    if (f.sourceId !== null && f.sourceId !== undefined && !sources.has(f.sourceId)) report('error', 'ref.unknown-source', 'منبع فیش «' + f.id + '» وجود ندارد: ' + f.sourceId, where, suggest(String(f.sourceId), sources.keys()));
    if (f.kind !== 'author' && !f.sourceId) report('error', 'fiche.source-required', 'فیش نقل‌قول یا خلاصه باید به منبع متصل باشد.', where);
    if (f.kind === 'quote' && !String(f.locator || '').trim()) report('error', 'fiche.locator-required', 'فیش نقل‌قول نشانی دقیق locator می‌خواهد.', where);
    if (f.kind === 'quote' && sources.has(f.sourceId)) {
      const ex = project.excerpt(f.sourceId);
      if (!ex.trim()) report('warning', 'quote.no-excerpt', 'متن مرجع برای بررسی نقل‌قول فیش «' + f.id + '» وارد نشده است.', where, 'گزیدهٔ منبع را در sources/excerpts/' + f.sourceId + '.txt بگذارید.');
      else if (!norm(ex).includes(norm(f.text))) report('warning', 'quote.mismatch', 'متن نقل‌قول فیش «' + f.id + '» در گزیدهٔ منبع یافت نشد؛ نیازمند بررسی است.', where);
    }
  }
  if (!b.authors || !b.authors.length) report('warning', 'book.no-author', 'نام مؤلف وارد نشده است.', { file: 'book.yaml' });

  // Global ids (unchanged chapters come from the index cache).
  const idx = project.index({ write: options.writeCache !== false });
  for (const [id, infos] of idx.ids) {
    if (infos.length > 1) {
      const where = infos.find(x => x.kind !== 'source' && x.kind !== 'fiche') || infos[0];
      report('error', 'id.duplicate', 'شناسهٔ «' + id + '» در کتاب تکراری است (' + infos.map(x => x.file + (x.line ? ':' + x.line : '')).join('، ') + ').', { file: where.file, line: where.line, nodeId: id });
    }
  }
  for (const t of project.glossary.terms) if (idx.ids.has(t.id)) report('error', 'id.duplicate', 'شناسهٔ اصطلاح «' + t.id + '» با شناسهٔ دیگری در کتاب یکی است.', { file: 'memory/glossary.yaml', nodeId: t.id });

  // Chapters: all, or only the requested ones.
  const selected = options.chapter ? [].concat(options.chapter) : project.chapters.map(c => c.id);
  let words = 0, blocks = 0;
  for (const chapterId of selected) {
    const entry = project.entry(chapterId);
    if (!entry) { report('error', 'chapter.unknown', 'فصل «' + chapterId + '» در outline نیست.', { file: 'outline.yaml' }); continue; }
    const ch = project.chapter(chapterId);
    for (const p of ch.problems) out.push(p);
    if (ch.raw === null) continue;
    const file = entry.file;
    if (ch.meta.id !== undefined && ch.meta.id !== chapterId) report('error', 'chapter.id-mismatch', 'شناسهٔ frontmatter («' + ch.meta.id + '») با outline («' + chapterId + '») یکی نیست.', { file, line: 2 });
    for (const fid of ch.meta.fiches || []) if (!fiches.has(fid)) report('error', 'ref.unknown-fiche', 'فیش «' + fid + '» در fiches.jsonl وجود ندارد.', { file, line: 1 }, suggest(fid, fiches.keys()));
    let count = 0;
    walk(ch.children, node => {
      count++;
      const where = { file, line: node.position.line, nodeId: node.id };
      const def = Blocks.get(node.type);
      const builtin = ['paragraph', 'list', 'table', 'section'].includes(node.type);
      if (!builtin && !def) report('error', 'block.unknown-type', 'نوع بلوک «' + node.type + '» در رجیستری نیست.', where, 'انواع مجاز: ' + Blocks.types().join('، '));
      if (def) {
        const attrSchema = Blocks.attributeSchema(node.type);
        for (const e of Schema.validate(attrSchema, node.attrs, attrSchema)) report('error', 'block.attribute', ':::' + node.type + ' ' + (e.path === '/' ? '' : e.path.slice(1) + ': ') + e.message, where);
        for (const name of Object.keys(node.slots || {})) if (!def.slots[name]) report('error', 'block.unknown-slot', 'بخش ::' + name + ' برای :::' + node.type + ' تعریف نشده است.', { file, line: node.slots[name].line, nodeId: node.id });
        def.check(node, { report: (sev, code, message, n, hint) => report(sev, code, message, { file, line: n.position.line, nodeId: n.id }, hint) });
        if (!node.children.length && !Object.keys(node.slots || {}).length) report('error', 'block.empty', 'بلوک :::' + node.type + ' متن ندارد.', where);
        walk(node.children, inner => { if (Blocks.get(inner.type)) report('error', 'block.nested', 'بلوک :::' + inner.type + ' نمی‌تواند داخل :::' + node.type + ' بیاید.', { file, line: inner.position.line, nodeId: inner.id }); });
      } else if (!builtin) return;
      else {
        const extra = Object.keys(node.attrs || {}).filter(k => k !== 'source' && k !== 'locator');
        if (extra.length) report('error', 'block.attribute', 'ویژگی ناشناخته برای ' + node.type + ': ' + extra.join('، '), where, 'برای بلوک‌های ساده فقط source و locator مجاز است.');
        if (node.attrs.locator && !node.attrs.source) report('error', 'block.attribute', 'locator بدون source آمده است.', where);
      }
      if ((def || node.type === 'section') && node.autoId) report('error', 'id.missing', (node.type === 'section' ? 'تیتر' : 'بلوک :::' + node.type) + ' شناسهٔ صریح ندارد.', where, 'bookengine ids <dir> --write شناسهٔ پایدار اضافه می‌کند.');
      if (node.id && !MD.ID.test(node.id)) report('error', 'id.invalid', 'شناسهٔ «' + node.id + '» معتبر نیست.', where);
      for (const attrKey of ['source']) {
        const sid = node.attrs && node.attrs[attrKey];
        if (sid && !sources.has(sid)) report('error', 'ref.unknown-source', 'منبع «' + sid + '» در sources.json وجود ندارد.', where, suggest(sid, sources.keys()));
      }
      if (node.type === 'quote' && sources.has(node.attrs.source)) {
        const ex = project.excerpt(node.attrs.source), text = nodeText(node);
        if (!ex.trim()) report('warning', 'quote.no-excerpt', 'متن مرجع برای بررسی نقل‌قول «' + node.id + '» وارد نشده است.', where);
        else if (!norm(ex).includes(norm(text))) report('warning', 'quote.mismatch', 'متن نقل‌قول «' + node.id + '» با گزیدهٔ منبع تطبیق پیدا نکرد.', where);
      }
      if (node.type === 'paragraph' && PLACEHOLDER.test(nodeText(node).trim())) report('warning', 'content.placeholder', 'بلوک «' + node.id + '» هنوز متن جایگزین دارد.', where);
      for (const list of inlineOf(node).concat(node.type === 'paragraph' ? [] : [])) {
        walkInline(list, x => {
          const w = { file, line: x.line || node.position.line, nodeId: node.id };
          if (x.type === 'cite' && MD.ID.test(x.sourceId) && !sources.has(x.sourceId)) report('error', 'ref.unknown-source', 'منبع ' + x.sourceId + ' در sources.json وجود ندارد.', w, suggest(x.sourceId, sources.keys()));
          if (x.type === 'xref' && !idx.ids.has(x.target)) report('error', 'ref.unknown-target', 'مقصد ارجاع «' + x.target + '» در کتاب وجود ندارد.', w, suggest(x.target, idx.ids.keys()));
          if (x.type === 'term' && !terms.has(x.termId)) report('error', 'ref.unknown-term', 'اصطلاح «' + x.termId + '» در memory/glossary.yaml نیست.', w, suggest(x.termId, terms.keys()));
        });
      }
    });
    if (!count) report('error', 'chapter.empty', 'فصل «' + chapterId + '» هیچ بلوکی ندارد.', { file, line: 1 });
    const w = wordCount(ch);
    words += w; blocks += count;
    const target = b.targets && b.targets.wordsPerChapter;
    if (target && entry.status !== 'planned' && (w < target[0] || w > target[1])) report('warning', 'content.length', 'فصل «' + chapterId + '» ' + w + ' واژه دارد؛ هدف ' + target[0] + ' تا ' + target[1] + ' است.', { file });
  }

  const errors = out.filter(x => x.severity === 'error'), warnings = out.filter(x => x.severity !== 'error');
  return {
    ok: errors.length === 0, errors, warnings,
    stats: { chapters: project.chapters.length, checkedChapters: selected.length, blocks, words, sources: project.sources.length, fiches: project.fiches.length, terms: project.glossary.terms.length, indexParsed: idx.parsed, indexCached: idx.cached }
  };
}

function groupByFile(list) {
  const g = {};
  for (const x of list) (g[x.file || '-'] = g[x.file || '-'] || []).push(x);
  return g;
}

module.exports = { validate, groupByFile, wordCount };
