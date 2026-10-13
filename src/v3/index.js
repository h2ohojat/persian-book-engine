'use strict';
// Public API of the BookEngine 0.3 project format.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('./yaml.js');
const Schema = require('./schema.js');
const MD = require('./markdown.js');
const Blocks = require('./blocks.js');
const { loadProject, walk } = require('./project.js');
const { validate } = require('./validate.js');
const Render = require('./render.js');
const { buildChapterContext } = require('./context.js');
const Migrate = require('./migrate.js');

function renderHtml(project, options) { return Render.renderBook(project, options).html; }

function newProject(dir, options) {
  options = options || {};
  const id = options.id || path.basename(path.resolve(dir)).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '') || 'my-book';
  const files = {
    'book.yaml': YAML.stringify({ bookEngine: 3, id, title: options.title || 'عنوان کتاب', subtitle: '', authors: [], audience: options.audience || '', description: '', format: options.format || 'textbook', language: 'fa', direction: 'rtl', versionLabel: '۰.۱', targets: { wordsPerChapter: [1500, 3000] } }),
    'style.yaml': YAML.stringify({ tone: 'روشن، دقیق و محترمانه', readingLevel: '', rules: ['مثال تألیفی را «مثال فرضی» بنامید.', 'آمار، منبع، نقل‌قول و شماره صفحه نسازید.'] }),
    'outline.yaml': YAML.stringify({ chapters: [{ id: 'intro', file: 'chapters/01-intro.md', status: 'planned' }] }),
    'chapters/01-intro.md': chapterTemplate('intro', 'مقدمه'),
    'sources/sources.json': '[]\n',
    'fiches/fiches.jsonl': '',
    'memory/glossary.yaml': 'terms: []\n',
    'memory/decisions.md': '# تصمیم‌های تألیفی\n\n',
    'memory/summaries/.gitkeep': '',
    '.gitignore': '.bookengine/\ndist/\n'
  };
  return Migrate.writeFiles(dir, files, options.force);
}

function chapterTemplate(id, title) {
  return '---\nid: ' + id + '\ntitle: ' + YAML.stringify(title).trim() + '\nobjectives: []\nfiches: []\n---\n\nمتن فصل را اینجا بنویسید\n';
}

function addChapter(dir, options) {
  const project = loadProject(dir);
  const id = options.id, title = options.title;
  if (!MD.ID.test(id || '')) throw new Error('شناسهٔ فصل معتبر نیست.');
  if (!title || !String(title).trim()) throw new Error('عنوان فصل لازم است.');
  if (project.entry(id)) throw new Error('فصل «' + id + '» از قبل وجود دارد.');
  const outlineFile = path.join(project.dir, 'outline.yaml');
  const outline = YAML.parse(fs.readFileSync(outlineFile, 'utf8'));
  const n = project.chapters.length + 1;
  const file = 'chapters/' + String(n).padStart(2, '0') + '-' + id + '.md';
  if (fs.existsSync(path.join(project.dir, file))) throw new Error('فایل ' + file + ' وجود دارد.');
  const item = { id, file, status: 'planned' };
  const lists = outline.parts ? outline.parts.map(p => p.chapters) : [outline.chapters || (outline.chapters = [])];
  let placed = false;
  if (options.after) for (const list of lists) {
    const k = list.findIndex(c => c.id === options.after);
    if (k >= 0) { list.splice(k + 1, 0, item); placed = true; break; }
  }
  if (options.after && !placed) throw new Error('فصل «' + options.after + '» برای --after پیدا نشد.');
  if (!placed) {
    if (options.part) { const part = (outline.parts || []).find(p => p.id === options.part); if (!part) throw new Error('بخش «' + options.part + '» پیدا نشد.'); part.chapters.push(item); }
    else lists[lists.length - 1].push(item);
  }
  const errs = Schema.check('outline', outline);
  if (errs.length) throw new Error('outline نامعتبر: ' + errs.map(e => e.path + ' ' + e.message).join('؛ '));
  fs.mkdirSync(path.join(project.dir, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(project.dir, file), chapterTemplate(id, title), { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(outlineFile, YAML.stringify(outline), 'utf8');
  return { id, file };
}

// Write stable ids into chapter files for every block that has none.
function writeIds(project, options) {
  const changed = [];
  const only = options && options.chapter ? [options.chapter] : project.chapters.map(c => c.id);
  for (const chapterId of only) {
    const ch = project.chapter(chapterId);
    if (ch.raw === null) continue;
    const eol = ch.raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = ch.raw.replace(/\r\n?/g, '\n').split('\n');
    const edits = [];
    walk(ch.children, n => {
      if (!n.autoId) return;
      const L = n.position.line - 1;
      if (n.type === 'section') edits.push({ at: L, kind: 'append', text: ' {#' + n.id + '}' });
      else if (Blocks.get(n.type)) edits.push({ at: L, kind: 'directive', id: n.id });
      else if (n.attrLine) edits.push({ at: n.attrLine - 1, kind: 'brace', id: n.id });
      else edits.push({ at: L, kind: 'insert', text: '{#' + n.id + '}' });
    });
    if (!edits.length) continue;
    edits.sort((a, b) => b.at - a.at);
    for (const e of edits) {
      if (e.kind === 'append') lines[e.at] = lines[e.at].replace(/\s*$/, '') + e.text;
      else if (e.kind === 'insert') lines.splice(e.at, 0, e.text);
      else if (e.kind === 'brace') lines[e.at] = lines[e.at].replace('{', '{#' + e.id + ' ');
      else if (e.kind === 'directive') lines[e.at] = /\{/.test(lines[e.at]) ? lines[e.at].replace('{', '{#' + e.id + ' ') : lines[e.at].replace(/\s*$/, '') + ' {#' + e.id + '}';
    }
    if (!options || !options.dryRun) fs.writeFileSync(path.join(project.dir, ch.entry.file), lines.join(eol), 'utf8');
    changed.push({ chapter: chapterId, file: ch.entry.file, ids: edits.length });
  }
  return changed;
}

function outlineReport(project) {
  const report = validate(project, { writeCache: true });
  const byFile = new Map();
  for (const x of report.errors.concat(report.warnings)) byFile.set(x.file, (byFile.get(x.file) || { errors: 0, warnings: 0 })), byFile.get(x.file)[x.severity === 'error' ? 'errors' : 'warnings']++;
  const { wordCount } = require('./validate.js');
  return project.chapters.map(c => {
    const ch = project.chapter(c.id), counts = byFile.get(c.file) || { errors: 0, warnings: 0 };
    return { number: c.number, id: c.id, part: c.partId, title: ch.meta.title || '', status: c.status, words: wordCount(ch), errors: counts.errors, warnings: counts.warnings };
  });
}

module.exports = {
  VERSION: Render.VERSION, CONTRACT: 3,
  loadProject, validate, renderBook: Render.renderBook, renderHtml, buildChapterContext,
  importV1: Migrate.importV1, exportV1: Migrate.exportV1, writeFiles: Migrate.writeFiles,
  newProject, addChapter, writeIds, outlineReport,
  blocks: Blocks, yaml: YAML, schema: Schema, markdown: MD
};
