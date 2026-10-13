'use strict';
// Project folder loader. Metadata and outline load eagerly; chapters parse lazily on demand,
// so working on one chapter never requires parsing the whole book.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('./yaml.js');
const Schema = require('./schema.js');
const MD = require('./markdown.js');

const MAX_FILE = 5 * 1024 * 1024;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const ABBR = { paragraph: 'p', list: 'l', table: 't', section: 's', heading: 's', callout: 'c', quote: 'q', exercise: 'x' };

function walk(nodes, visit, parent) {
  for (const n of nodes || []) {
    visit(n, parent);
    if (n.type === 'section' || (n.children && n.type !== 'listItem' && !isInlineContainer(n))) walk(n.children, visit, n);
  }
}
function isInlineContainer(n) { return n.type === 'paragraph' || n.type === 'listItem'; }
function inlineOf(n) {
  if (n.type === 'paragraph') return [n.children];
  if (n.type === 'section') return [n.title];
  if (n.type === 'list') return n.items.map(i => i.children);
  if (n.type === 'table') return [].concat(n.header, ...n.rows);
  const out = [];
  if (n.slots) for (const s of Object.values(n.slots)) out.push(s.children);
  return out;
}
function walkInline(nodes, visit) {
  for (const n of nodes || []) { visit(n); if (n.children) walkInline(n.children, visit); }
}
function nodeText(n) {
  if (n.type === 'paragraph') return MD.plain(n.children);
  if (n.type === 'section') return MD.plain(n.title);
  if (n.type === 'list') return n.items.map(i => MD.plain(i.children)).join('\n');
  if (n.type === 'table') return [n.header, ...n.rows].map(r => r.map(c => MD.plain(c)).join(' | ')).join('\n');
  return (n.children || []).map(nodeText).join('\n\n');
}

class Project {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.problems = [];
    this._chapters = new Map();
    this._excerpts = new Map();
    if (!fs.existsSync(path.join(this.dir, 'book.yaml'))) throw new Error('پوشهٔ پروژه book.yaml ندارد: ' + this.dir);
    this.book = this._yaml('book.yaml', 'book', true);
    this.style = this._yaml('style.yaml', 'style', false) || {};
    const outline = this._yaml('outline.yaml', 'outline', true) || {};
    this.glossary = this._yaml('memory/glossary.yaml', 'glossary', false) || { terms: [] };
    this.glossary.terms = this.glossary.terms || [];
    this.workflow = this._yaml('memory/workflow.yaml', 'workflow', false) || { completed: [], notes: {} };
    this.sources = this._sources();
    this.fiches = this._fiches();
    this.parts = [];
    this.chapters = [];
    if (outline.parts && outline.chapters) this._problem('outline.yaml', null, 'outline.shape', 'outline باید یا parts داشته باشد یا chapters، نه هر دو.');
    if (!outline.parts && !outline.chapters) this._problem('outline.yaml', null, 'outline.empty', 'outline هیچ فصلی ندارد.');
    const add = (c, part) => {
      if (!c || typeof c !== 'object') return;
      this.chapters.push({ id: c.id, file: c.file, status: c.status || 'drafted', approvedBy: c.approvedBy, approvedAt: c.approvedAt, partId: part ? part.id : null, number: this.chapters.length + 1 });
    };
    if (Array.isArray(outline.parts)) for (const part of outline.parts) {
      if (!part || typeof part !== 'object') continue;
      this.parts.push({ id: part.id, title: part.title, chapterIds: (part.chapters || []).map(c => c && c.id) });
      (part.chapters || []).forEach(c => add(c, part));
    }
    else if (Array.isArray(outline.chapters)) outline.chapters.forEach(c => add(c, null));
  }

  _problem(file, line, code, message, extra) {
    this.problems.push(Object.assign({ severity: 'error', code, file, line, message }, extra || {}));
  }
  _read(rel, required) {
    const full = path.join(this.dir, rel);
    if (!full.startsWith(this.dir + path.sep)) { this._problem(rel, null, 'file.outside', 'مسیر خارج از پوشهٔ پروژه است: ' + rel); return null; }
    if (!fs.existsSync(full)) { if (required) this._problem(rel, null, 'file.missing', 'فایل «' + rel + '» وجود ندارد.'); return null; }
    const stat = fs.statSync(full);
    if (stat.size > MAX_FILE) { this._problem(rel, null, 'file.too-large', 'فایل «' + rel + '» بیش از ۵ مگابایت است.'); return null; }
    return fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  }
  _schemaProblems(rel, name, value, prefix) {
    for (const e of Schema.check(name, value)) this._problem(rel, null, 'schema.' + e.keyword, (prefix || '') + e.path + ': ' + e.message);
  }
  _yaml(rel, schema, required) {
    const raw = this._read(rel, required);
    if (raw === null) return null;
    let value;
    try { value = YAML.parse(raw); } catch (e) { this._problem(rel, e.line || null, 'syntax.yaml', e.message); return null; }
    this._schemaProblems(rel, schema, value);
    return Schema.applyDefaults(Schema.load(schema), value);
  }
  _sources() {
    const rel = 'sources/sources.json', raw = this._read(rel, false);
    if (raw === null) return [];
    let list;
    try { list = JSON.parse(raw); } catch (_) { this._problem(rel, null, 'syntax.json', 'sources.json معتبر نیست.'); return []; }
    this._schemaProblems(rel, 'sources', list);
    if (!Array.isArray(list)) return [];
    const itemSchema = Schema.load('sources').items;
    return list.filter(s => s && typeof s === 'object').map(s => Schema.applyDefaults(itemSchema, s));
  }
  _fiches() {
    const rel = 'fiches/fiches.jsonl', raw = this._read(rel, false);
    if (raw === null) return [];
    const out = [];
    raw.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      let f;
      try { f = JSON.parse(line); } catch (_) { this._problem(rel, i + 1, 'syntax.json', 'سطر ' + (i + 1) + ' یک شیء JSON معتبر نیست.'); return; }
      for (const e of Schema.check('fiche', f)) this._problem(rel, i + 1, 'schema.' + e.keyword, e.path + ': ' + e.message);
      if (f && typeof f === 'object' && !Array.isArray(f)) out.push(Object.assign(Schema.applyDefaults(Schema.load('fiche'), f), { line: i + 1 }));
    });
    return out;
  }

  excerpt(sourceId) {
    if (!this._excerpts.has(sourceId)) {
      const ok = MD.ID.test(sourceId);
      this._excerpts.set(sourceId, ok ? (this._read('sources/excerpts/' + sourceId + '.txt', false) || '') : '');
    }
    return this._excerpts.get(sourceId);
  }
  entry(chapterId) { return this.chapters.find(c => c.id === chapterId); }
  raw(entry) { return this._read(entry.file, true); }

  // Parse one chapter (cached). Missing block ids are filled with stable content-hash ids.
  chapter(chapterId) {
    if (this._chapters.has(chapterId)) return this._chapters.get(chapterId);
    const entry = this.entry(chapterId);
    if (!entry) throw new Error('فصل «' + chapterId + '» در outline نیست.');
    const before = this.problems.length;
    const raw = this.raw(entry);
    const fileProblems = this.problems.splice(before);
    const parsed = raw === null ? { meta: {}, children: [], problems: [] } : MD.parseChapter(raw, entry.file);
    const ch = { entry, raw, hash: raw === null ? null : hash(raw), meta: parsed.meta || {}, children: parsed.children, problems: fileProblems.concat(parsed.problems) };
    for (const e of Schema.check('chapter', ch.meta)) ch.problems.push({ severity: 'error', code: 'schema.' + e.keyword, file: entry.file, line: 1, message: 'frontmatter' + e.path + ': ' + e.message });
    Schema.applyDefaults(Schema.load('chapter'), ch.meta);
    assignIds(ch, chapterId);
    this._chapters.set(chapterId, ch);
    return ch;
  }

  // Ids of every chapter, using .bookengine/index.json so unchanged chapters are not re-parsed.
  index(options) {
    const cacheFile = path.join(this.dir, '.bookengine', 'index.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { cache = {}; }
    const result = { ids: new Map(), parsed: 0, cached: 0 };
    const addId = (id, info) => { if (!result.ids.has(id)) result.ids.set(id, []); result.ids.get(id).push(info); };
    for (const s of this.sources) addId(s.id, { kind: 'source', file: 'sources/sources.json' });
    for (const f of this.fiches) addId(f.id, { kind: 'fiche', file: 'fiches/fiches.jsonl', line: f.line });
    for (const p of this.parts) addId(p.id, { kind: 'part', file: 'outline.yaml', title: p.title });
    const next = {};
    for (const entry of this.chapters) {
      const raw = this._chapters.has(entry.id) ? this._chapters.get(entry.id).raw : this._readQuiet(entry.file);
      const h = raw === null ? null : hash(raw);
      let list, title;
      if (h && cache[entry.id] && cache[entry.id].hash === h && Array.isArray(cache[entry.id].ids) && !this._chapters.has(entry.id)) { list = cache[entry.id].ids; title = cache[entry.id].title; result.cached++; }
      else {
        const ch = this.chapter(entry.id);
        title = typeof ch.meta.title === 'string' ? ch.meta.title : '';
        list = [];
        walk(ch.children, n => { if (n.id) list.push({ id: n.id, type: n.type, title: n.type === 'section' ? MD.plain(n.title) : '', line: n.position.line }); });
        result.parsed++;
      }
      next[entry.id] = { hash: h, title, ids: list };
      addId(entry.id, { kind: 'chapter', file: entry.file, chapterId: entry.id, title, number: entry.number });
      for (const x of list) addId(x.id, { kind: x.type, file: entry.file, line: x.line, chapterId: entry.id, title: x.title });
    }
    if (!options || options.write !== false) {
      try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(next)); } catch (_) { /* cache is optional */ }
    }
    return result;
  }
  _readQuiet(rel) {
    const full = path.join(this.dir, rel);
    try { return fs.statSync(full).size > MAX_FILE ? null : fs.readFileSync(full, 'utf8').replace(/^﻿/, ''); } catch (_) { return null; }
  }
}

function assignIds(ch, chapterId) {
  const used = new Set();
  walk(ch.children, n => { if (n.id) used.add(n.id); });
  walk(ch.children, n => {
    if (n.id) return;
    const base = chapterId + '-' + (ABBR[n.type] || 'b') + '-' + hash(n.type + '\n' + nodeText(n)).slice(0, 4);
    let id = base, k = 2;
    while (used.has(id)) id = base + '-' + k++;
    used.add(id);
    n.id = id;
    n.autoId = true;
  });
}

function loadProject(dir) { return new Project(dir); }

module.exports = { loadProject, Project, walk, walkInline, inlineOf, nodeText, hash };
