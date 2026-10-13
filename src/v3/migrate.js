'use strict';
// BOOK v1 (or a 0.2 project backup) ⇄ 0.3 project folder.
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const YAML = require('./yaml.js');
const MD = require('./markdown.js');
const { walk, nodeText } = require('./project.js');

const pad = n => String(n).padStart(2, '0');

// v1 project object (output of SDK.parseInput) → {files: {relPath: text}, warnings}
function importV1(p, options) {
  options = options || {};
  const warnings = [];
  const m = p.metadata;
  const book = { bookEngine: 3, id: p.id, title: m.title, subtitle: m.subtitle, authors: m.author ? [m.author] : [], audience: m.audience, description: m.description, format: m.format, language: 'fa', direction: 'rtl', versionLabel: m.versionLabel };
  const files = {};
  files['book.yaml'] = YAML.stringify(book);
  files['style.yaml'] = YAML.stringify({ rules: ['مثال تألیفی را «مثال فرضی» بنامید.', 'آمار، منبع، نقل‌قول و شماره صفحه نسازید.'] });
  const chapters = [];
  p.chapters.forEach((c, i) => {
    const file = 'chapters/' + pad(i + 1) + '-' + c.id + '.md';
    chapters.push({ id: c.id, file, status: 'drafted' });
    files[file] = chapterFromV1(c, warnings);
  });
  files['outline.yaml'] = YAML.stringify({ chapters });
  files['sources/sources.json'] = JSON.stringify(p.sources.map(s => ({ id: s.id, title: s.title, creator: s.creator, year: s.year, locator: s.locator, url: s.url, verified: s.verified })), null, 2) + '\n';
  for (const s of p.sources) if (s.excerpt) files['sources/excerpts/' + s.id + '.txt'] = s.excerpt;
  files['fiches/fiches.jsonl'] = p.fiches.map(f => JSON.stringify({ id: f.id, kind: f.kind, sourceId: f.sourceId, text: f.text, locator: f.locator, keywords: f.keywords })).join('\n') + (p.fiches.length ? '\n' : '');
  files['memory/glossary.yaml'] = 'terms: []\n';
  files['memory/decisions.md'] = '# تصمیم‌های تألیفی\n\n';
  if (p.workflow && (p.workflow.completed.length || Object.keys(p.workflow.notes).length)) files['memory/workflow.yaml'] = YAML.stringify(p.workflow);
  files['.gitignore'] = '.bookengine/\ndist/\n';
  return { files, warnings };
}

function blockAttrs(b, extra) {
  const a = Object.assign({}, extra || {});
  if (b.sourceId) { a.source = b.sourceId; if (b.locator) a.locator = b.locator; }
  return a;
}

function chapterFromV1(c, warnings) {
  const front = YAML.stringify({ id: c.id, title: c.title, objectives: c.objectives, fiches: c.fichIds });
  const out = ['---', front.trimEnd(), '---', ''];
  const text = t => MD.escapeText(t);
  for (const b of c.blocks) {
    if (/\n\s*\n/.test(b.text)) warnings.push({ code: 'import.blank-line', nodeId: b.id, message: 'متن بلوک «' + b.id + '» سطر خالی دارد و در Markdown به چند پاراگراف تقسیم می‌شود.' });
    if (b.type === 'heading') {
      out.push('## ' + text(b.text).replace(/\n/g, ' ') + ' ' + MD.attrString(b.id, blockAttrs(b)), '');
    } else if (b.type === 'paragraph') {
      out.push(MD.attrString(b.id, blockAttrs(b)), text(b.text), '');
    } else if (b.type === 'list') {
      if (b.text && b.text.trim()) warnings.push({ code: 'import.list-text', nodeId: b.id, message: 'متن بالای فهرست «' + b.id + '» در ۰.۲ نمایش داده نمی‌شد و به پاراگراف جدا تبدیل شد.' });
      if (b.text && b.text.trim()) out.push(text(b.text), '');
      out.push(MD.attrString(b.id, blockAttrs(b)), b.items.map(item => '- ' + text(item).split('\n').join('\n  ')).join('\n'), '');
    } else {
      const attrs = blockAttrs(b, b.type === 'exercise' ? { lines: b.lines } : {});
      out.push(':::' + b.type + ' ' + MD.attrString(b.id, attrs), text(b.text));
      if (b.type === 'exercise' && b.rubric) {
        if (/\n/.test(b.rubric)) out.push('', '::rubric[' + MD.escapeInline(b.rubric).replace(/\n/g, ' ') + ']'), warnings.push({ code: 'import.rubric-newline', nodeId: b.id, message: 'سطرهای معیار تمرین «' + b.id + '» در یک سطر ادغام شد.' });
        else out.push('', '::rubric[' + MD.escapeInline(b.rubric) + ']');
      }
      out.push(':::', '');
    }
  }
  return out.join('\n');
}

// 0.3 project → v1 project object (schemaVersion 1) + warnings for anything v1 cannot hold.
function exportV1(project) {
  const warnings = [];
  const warn = (code, message, nodeId) => warnings.push(Object.assign({ code, message }, nodeId ? { nodeId } : {}));
  const b = project.book, p = E.emptyProject();
  p.id = b.id;
  p.metadata = { title: b.title, subtitle: b.subtitle || '', author: (b.authors || []).join('، '), audience: b.audience || '', description: b.description || '', language: 'fa', direction: 'rtl', format: b.format, versionLabel: b.versionLabel || '' };
  if ((b.authors || []).length > 1) warn('export.authors', 'چند مؤلف در یک فیلد author ادغام شد.');
  p.sources = project.sources.map(s => ({ id: s.id, title: s.title, creator: s.creator || '', year: s.year || '', locator: s.locator || '', url: s.url || '', excerpt: project.excerpt(s.id), verified: !!s.verified }));
  p.fiches = project.fiches.map(f => ({ id: f.id, sourceId: f.sourceId === undefined ? null : f.sourceId, kind: f.kind, text: f.text, locator: f.locator || '', keywords: f.keywords || '' }));
  p.workflow = { completed: (project.workflow.completed || []).slice(), notes: Object.assign({}, project.workflow.notes || {}) };
  if (project.parts.length) warn('export.parts', 'بخش‌های کتاب (parts) در v1 وجود ندارند و حذف شدند؛ ترتیب فصل‌ها حفظ شد.');
  if (project.glossary.terms.length) warn('export.glossary', 'واژه‌نامه در v1 وجود ندارد؛ اصطلاح‌ها به متن ساده تبدیل شدند.');
  const terms = new Map(project.glossary.terms.map(t => [t.id, t.term]));
  const plainOpts = { cites: true, term: id => terms.get(id) || id };
  const inlineText = nodes => {
    let lost = false;
    walkI(nodes, n => { if (['footnote', 'cite', 'emphasis', 'strong', 'link', 'xref', 'code'].includes(n.type)) lost = true; });
    return { text: MD.plain(nodes, plainOpts), lost };
  };
  for (const entry of project.chapters) {
    const ch = project.chapter(entry.id), blocks = [];
    const push = (type, node, fields) => blocks.push(Object.assign({ id: node.id, type, text: '', sourceId: (node.attrs && node.attrs.source) || null, locator: (node.attrs && node.attrs.locator) || '', rubric: '', items: [], lines: 4 }, fields));
    const flat = (nodes, depthWarned) => {
      for (const n of nodes) {
        if (n.type === 'section') {
          if (n.depth > 1 && !depthWarned) { warn('export.section-depth', 'زیربخش‌های تودرتو در v1 به تیتر ساده تبدیل شدند.', n.id); depthWarned = true; }
          push('heading', n, { text: inlineText(n.title).text });
          flat(n.children, depthWarned);
        } else if (n.type === 'paragraph') {
          const r = inlineText(n.children);
          if (r.lost) warn('export.inline', 'قالب‌بندی، پانویس یا ارجاع درون‌متنی بلوک «' + n.id + '» به متن ساده تبدیل شد.', n.id);
          push('paragraph', n, { text: r.text });
        } else if (n.type === 'list') {
          push('list', n, { items: n.items.map(i => inlineText(i.children).text) });
        } else if (n.type === 'table') {
          warn('export.table', 'جدول «' + n.id + '» به پاراگراف متنی تبدیل شد.', n.id);
          push('paragraph', n, { text: nodeText(n) });
        } else {
          const text = n.children.map(c => c.type === 'list' ? c.items.map(i => '- ' + MD.plain(i.children, plainOpts)).join('\n') : c.type === 'paragraph' ? MD.plain(c.children, plainOpts) : nodeText(c)).join('\n\n');
          const fields = { text };
          if (n.type === 'exercise') { fields.lines = n.attrs.lines || 4; fields.rubric = n.slots.rubric ? MD.plain(n.slots.rubric.children, plainOpts) : (n.attrs.rubric || ''); }
          push(n.type, n, fields);
        }
      }
    };
    flat(ch.children, false);
    p.chapters.push({ id: entry.id, title: ch.meta.title, objectives: (ch.meta.objectives || []).slice(), fichIds: (ch.meta.fiches || []).slice(), blocks });
  }
  const check = E.validateProject(p);
  if (!check.ok) throw new Error('خروجی v1 معتبر نیست:\n' + check.errors.join('\n'));
  return { project: p, warnings };
}
function walkI(nodes, visit) { for (const n of nodes || []) { visit(n); if (n.children) walkI(n.children, visit); } }

function writeFiles(dir, files, force) {
  const root = path.resolve(dir);
  if (fs.existsSync(root) && fs.readdirSync(root).length && !force) throw Object.assign(new Error('پوشهٔ مقصد خالی نیست؛ برای جایگزینی آگاهانه --force اضافه کنید.'), { code: 'EEXIST' });
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (!full.startsWith(root + path.sep)) throw new Error('مسیر نامعتبر: ' + rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return root;
}

module.exports = { importV1, exportV1, writeFiles, chapterFromV1 };
