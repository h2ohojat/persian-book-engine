'use strict';
// Chapter parser: YAML frontmatter + a restricted Markdown dialect + ::: directives.
// Raw HTML is never interpreted; it stays text. Every node carries position {file, line}.
const YAML = require('./yaml.js');

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const PUNCT = /[!-\/:-@\[-`{-~]/;

function problem(list, file, line, code, message, extra) {
  list.push(Object.assign({ severity: 'error', code, file, line, message }, extra || {}));
}

// ---------- attributes: {#id key=value key="json string"} ----------
function parseAttributes(text, file, line, problems) {
  const out = { id: null, attrs: {} };
  let i = 0;
  const s = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '#') {
      const m = /^#([^\s}]+)/.exec(s.slice(i));
      out.id = m ? m[1] : '';
      i += m ? m[0].length : 1;
      continue;
    }
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*)=/.exec(s.slice(i));
    if (!m) { problem(problems, file, line, 'syntax.attribute', 'ویژگی بلوک نامعتبر است: ' + s.slice(i, i + 20)); break; }
    i += m[0].length;
    let value;
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      try { value = JSON.parse(s.slice(i, j + 1)); } catch (_) { problem(problems, file, line, 'syntax.attribute', 'مقدار داخل گیومه برای «' + m[1] + '» معتبر نیست.'); value = ''; }
      i = j + 1;
    } else {
      const v = /^[^\s"]*/.exec(s.slice(i))[0];
      value = /^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
      i += v.length;
    }
    if (Object.prototype.hasOwnProperty.call(out.attrs, m[1])) problem(problems, file, line, 'syntax.attribute', 'ویژگی تکراری «' + m[1] + '».');
    out.attrs[m[1]] = value;
  }
  return out;
}

// ---------- inline ----------
function findClose(s, from, open, close) {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '`') { const j = s.indexOf('`', i + 1); if (j > 0) { i = j; continue; } }
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

function parseInline(s, ctx) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ type: 'text', value: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) { flush(); out.push({ type: 'code', value: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if (c === '*') {
      const strong = s[i + 1] === '*';
      const mark = strong ? '**' : '*';
      const j = s.indexOf(mark, i + mark.length);
      if (j > i + mark.length && !/\s/.test(s[i + mark.length]) && (strong || s[j + 1] !== '*')) {
        flush(); out.push({ type: strong ? 'strong' : 'emphasis', children: parseInline(s.slice(i + mark.length, j), ctx) });
        i = j + mark.length; continue;
      }
    }
    if (c === '^' && s[i + 1] === '[') {
      const j = findClose(s, i + 2, '[', ']');
      if (j > 0) { flush(); out.push({ type: 'footnote', children: parseInline(s.slice(i + 2, j), ctx) }); i = j + 1; continue; }
    }
    if (c === '[' && s[i + 1] === '@') {
      const j = findClose(s, i + 1, '[', ']');
      if (j > 0) {
        const body = s.slice(i + 2, j), semi = body.indexOf(';');
        const sourceId = (semi < 0 ? body : body.slice(0, semi)).trim();
        const locator = semi < 0 ? '' : body.slice(semi + 1).trim();
        flush(); out.push({ type: 'cite', sourceId, locator, line: ctx.line });
        if (!ID.test(sourceId)) problem(ctx.problems, ctx.file, ctx.line, 'syntax.cite', 'شناسهٔ منبع در ارجاع معتبر نیست: ' + sourceId);
        i = j + 1; continue;
      }
    }
    if (c === '[') {
      const j = findClose(s, i + 1, '[', ']');
      if (j > 0 && s[j + 1] === '(') {
        const k = findClose(s, j + 2, '(', ')');
        if (k > 0) {
          const target = s.slice(j + 2, k).trim(), children = parseInline(s.slice(i + 1, j), ctx);
          flush();
          if (target.startsWith('#ref:')) out.push({ type: 'xref', target: target.slice(5), children, line: ctx.line });
          else {
            if (!/^https?:\/\/\S+$/.test(target)) problem(ctx.problems, ctx.file, ctx.line, 'syntax.link', 'لینک فقط می‌تواند http یا https یا #ref:شناسه باشد.');
            out.push({ type: 'link', url: /^https?:\/\/\S+$/.test(target) ? target : '', children });
          }
          i = k + 1; continue;
        }
      }
    }
    if (c === '{' && s.startsWith('{term:', i)) {
      const j = s.indexOf('}', i);
      if (j > 0) { flush(); out.push({ type: 'term', termId: s.slice(i + 6, j).trim(), line: ctx.line }); i = j + 1; continue; }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

// ---------- blocks ----------
const RE = {
  attr: /^\{(?:#[^\s}]+|[a-zA-Z][\w-]*=).*\}\s*$/,
  heading: /^(#{1,6})\s+(.*?)\s*$/,
  headingId: /\s+(\{#[^}]*\})\s*$/,
  dirOpen: /^:::([a-zA-Z][a-zA-Z0-9-]*)\s*(\{.*\})?\s*$/,
  dirClose: /^:::\s*$/,
  slot: /^::([a-zA-Z][a-zA-Z0-9-]*)\[(.*)\]\s*$/,
  bullet: /^[-*+]\s+/,
  ordered: /^\d{1,9}[.)]\s+/,
  tableSep: /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
};
const startsBlock = (l, next) => RE.attr.test(l) || RE.heading.test(l) || RE.dirOpen.test(l) || RE.bullet.test(l) || RE.ordered.test(l) || (l.startsWith('|') && next !== undefined && RE.tableSep.test(next));

function splitRow(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = []; let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (t[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function parseBlocks(lines, from, to, ctx, inDirective) {
  const blocks = [];
  let pending = null, i = from;
  const pos = n => ({ file: ctx.file, line: ctx.offset + n + 1 });
  const take = node => {
    if (pending) {
      if (node.id && pending.id) problem(ctx.problems, ctx.file, node.position.line, 'syntax.attribute', 'برای این بلوک دو شناسه نوشته شده است.');
      node.id = node.id || pending.id;
      node.attrs = Object.assign({}, pending.attrs, node.attrs || {});
      node.attrLine = pending.line;
      pending = null;
    }
    node.attrs = node.attrs || {};
    blocks.push(node);
  };
  while (i < to) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const p = pos(i), ictx = { file: ctx.file, line: p.line, problems: ctx.problems };
    if (RE.attr.test(line)) {
      if (pending) problem(ctx.problems, ctx.file, p.line, 'syntax.attribute', 'سطر ویژگی بدون بلوک بعدی.');
      pending = parseAttributes(line, ctx.file, p.line, ctx.problems);
      pending.line = p.line; i++; continue;
    }
    let m;
    if ((m = RE.dirOpen.exec(line))) {
      let depth = 1, j = i + 1;
      for (; j < to; j++) {
        if (RE.dirOpen.test(lines[j])) depth++;
        else if (RE.dirClose.test(lines[j]) && --depth === 0) break;
      }
      if (j >= to) { problem(ctx.problems, ctx.file, p.line, 'syntax.directive', 'بلوک :::' + m[1] + ' بسته نشده است.', { hint: 'یک سطر ::: در پایان بلوک بگذارید.' }); j = to; }
      const a = m[2] ? parseAttributes(m[2], ctx.file, p.line, ctx.problems) : { id: null, attrs: {} };
      const slots = {}, inner = [];
      for (let k = i + 1; k < j; k++) {
        const sm = RE.slot.exec(lines[k]);
        if (sm) { slots[sm[1]] = { children: parseInline(sm[2], { file: ctx.file, line: ctx.offset + k + 1, problems: ctx.problems }), line: ctx.offset + k + 1 }; inner.push(''); }
        else inner.push(lines[k]);
      }
      const sub = parseBlocks(inner, 0, inner.length, { file: ctx.file, offset: ctx.offset + i + 1, problems: ctx.problems }, true);
      take({ type: m[1], id: a.id, attrs: a.attrs, slots, children: sub, position: p, explicitId: !!a.id || !!pending });
      i = j + 1; continue;
    }
    if (RE.dirClose.test(line)) { problem(ctx.problems, ctx.file, p.line, 'syntax.directive', 'سطر ::: بدون بلوک باز.'); i++; continue; }
    if (RE.slot.test(line)) { problem(ctx.problems, ctx.file, p.line, 'syntax.directive', 'سطر ::' + RE.slot.exec(line)[1] + ' فقط داخل یک بلوک ::: مجاز است.'); i++; continue; }
    if ((m = RE.heading.exec(line))) {
      const level = m[1].length;
      let text = m[2], id = null, attrs = {};
      const hm = RE.headingId.exec(text);
      if (hm) { const a = parseAttributes(hm[1], ctx.file, p.line, ctx.problems); id = a.id; attrs = a.attrs; text = text.slice(0, hm.index); }
      if (inDirective) problem(ctx.problems, ctx.file, p.line, 'syntax.heading', 'تیتر داخل بلوک ::: مجاز نیست.');
      else if (level < 2 || level > 4) problem(ctx.problems, ctx.file, p.line, 'syntax.heading', 'در فصل فقط تیتر ## تا #### مجاز است؛ عنوان فصل در frontmatter است.');
      take({ type: 'heading', level: Math.min(Math.max(level, 2), 4), id, attrs, children: parseInline(text, ictx), position: p, explicitId: !!id || !!pending });
      i++; continue;
    }
    if (line.startsWith('|') && i + 1 < to && RE.tableSep.test(lines[i + 1])) {
      const header = splitRow(line), rows = [];
      let j = i + 2;
      while (j < to && lines[j].trim().startsWith('|')) { rows.push(splitRow(lines[j])); j++; }
      const cell = (t, n) => parseInline(t, { file: ctx.file, line: ctx.offset + n + 1, problems: ctx.problems });
      take({ type: 'table', header: header.map(t => cell(t, i)), rows: rows.map((r, k) => r.map(t => cell(t, i + 2 + k))), position: p, explicitId: !!pending });
      i = j; continue;
    }
    if (RE.bullet.test(line) || RE.ordered.test(line)) {
      const ordered = RE.ordered.test(line), re = ordered ? RE.ordered : RE.bullet;
      const items = [];
      let j = i;
      while (j < to) {
        const l = lines[j];
        if (re.test(l)) { items.push({ lines: [l.replace(re, '')], line: ctx.offset + j + 1 }); j++; continue; }
        if (/^ {2,}\S/.test(l) && items.length) { items[items.length - 1].lines.push(l.replace(/^ {2,}/, '')); j++; continue; }
        break;
      }
      take({ type: 'list', ordered, items: items.map(it => ({ type: 'listItem', children: parseInline(it.lines.join('\n'), { file: ctx.file, line: it.line, problems: ctx.problems }) })), position: p, explicitId: !!pending });
      i = j; continue;
    }
    const para = [line];
    let j = i + 1;
    while (j < to && lines[j].trim() !== '' && !startsBlock(lines[j], lines[j + 1]) && !RE.dirClose.test(lines[j])) { para.push(lines[j]); j++; }
    take({ type: 'paragraph', children: parseInline(para.join('\n'), ictx), position: p, explicitId: !!pending });
    i = j;
  }
  if (pending) problem(ctx.problems, ctx.file, pending.line, 'syntax.attribute', 'سطر ویژگی بدون بلوک بعدی.');
  return blocks;
}

// Group headings into nested sections: ## → depth 1, ### → 2, #### → 3.
function sectionize(blocks) {
  const root = { children: [] }, stack = [{ depth: 0, node: root }];
  for (const b of blocks) {
    if (b.type === 'heading') {
      const depth = b.level - 1;
      while (stack[stack.length - 1].depth >= depth) stack.pop();
      const section = { type: 'section', id: b.id, attrs: b.attrs, depth, title: b.children, position: b.position, explicitId: b.explicitId, children: [] };
      stack[stack.length - 1].node.children.push(section);
      stack.push({ depth, node: section });
    } else stack[stack.length - 1].node.children.push(b);
  }
  return root.children;
}

function parseChapter(source, file) {
  const problems = [];
  const text = String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  let meta = {}, start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0) problem(problems, file, 1, 'syntax.frontmatter', 'frontmatter با --- بسته نشده است.');
    else {
      try { meta = YAML.parse(lines.slice(1, end).join('\n')); }
      catch (e) { problem(problems, file, (e.line || 0) + 1, 'syntax.frontmatter', 'frontmatter: ' + e.message); }
      start = end + 1;
    }
  } else problem(problems, file, 1, 'syntax.frontmatter', 'فایل فصل باید با frontmatter (---) شروع شود.', { hint: 'id و title فصل را در frontmatter بنویسید.' });
  const body = lines.slice(start);
  const blocks = parseBlocks(body, 0, body.length, { file, offset: start, problems }, false);
  return { meta, children: sectionize(blocks), problems };
}

// ---------- plain text and serialization helpers ----------
function plain(nodes, opts) {
  opts = opts || {};
  return (nodes || []).map(n => {
    if (n.type === 'text' || n.type === 'code') return n.value;
    if (n.type === 'footnote') return opts.footnotes === false ? '' : ' (' + plain(n.children, opts) + ')';
    if (n.type === 'cite') return opts.cites ? '[' + n.sourceId + (n.locator ? '؛ ' + n.locator : '') + ']' : '';
    if (n.type === 'term') return opts.term ? opts.term(n.termId) : n.termId;
    if (n.children) return plain(n.children, opts);
    return '';
  }).join('');
}

function escapeInline(text) {
  return String(text).replace(/[\\*\[\]^{}`|]/g, c => '\\' + c);
}
function escapeLine(line) {
  if (/^(#|[-*+]\s|:::?|\||\{)/.test(line) || line === '-' || line === '*' || line === '+') return '\\' + line;
  return line.replace(/^(\d{1,9})([.)])(\s)/, '$1\\$2$3');
}
function escapeText(text) { return escapeInline(text).split('\n').map(escapeLine).join('\n'); }
function attrString(id, attrs) {
  const parts = [];
  if (id) parts.push('#' + id);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(k + '=' + (typeof v === 'number' || typeof v === 'boolean' || /^[A-Za-z0-9_-]+$/.test(String(v)) ? String(v) : JSON.stringify(String(v))));
  }
  return parts.length ? '{' + parts.join(' ') + '}' : '';
}

module.exports = { parseChapter, parseInline, parseAttributes, plain, escapeInline, escapeText, escapeLine, attrString, ID };
