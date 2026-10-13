'use strict';
// Safe YAML subset: block mappings, block sequences, flow [..] and {..}, plain/quoted scalars,
// literal block scalars (|), comments. No tags, anchors, aliases or multi-document streams.

class YamlError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function parseScalar(raw, line) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return Number(s);
  if (s[0] === '"') {
    try { return JSON.parse(s); } catch (_) { throw new YamlError('رشتهٔ داخل گیومه معتبر نیست.', line); }
  }
  if (s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== "'") throw new YamlError('رشتهٔ تک‌گیومه بسته نشده است.', line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!%@`|>]/.test(s)) throw new YamlError('این ویژگی YAML پشتیبانی نمی‌شود: ' + s[0], line);
  return s;
}

function parseFlow(text, line) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function value() {
    ws();
    const c = text[i];
    if (c === '[') {
      i++; const out = []; ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value()); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        throw new YamlError('فهرست [..] درست بسته نشده است.', line);
      }
    }
    if (c === '{') {
      i++; const out = {}; ws();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        ws();
        const key = scalarUntil(/[:]/);
        if (text[i] !== ':') throw new YamlError('کلید {..} بدون «:» است.', line);
        i++;
        setKey(out, String(key), value(), line); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return out; }
        throw new YamlError('نگاشت {..} درست بسته نشده است.', line);
      }
    }
    return scalarUntil(/[,\]}]/);
  }
  function scalarUntil(stop) {
    ws();
    const start = i;
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]; i++;
      while (i < text.length && text[i] !== q) { if (q === '"' && text[i] === '\\') i++; i++; }
      i++;
      return parseScalar(text.slice(start, i), line);
    }
    while (i < text.length && !stop.test(text[i])) i++;
    return parseScalar(text.slice(start, i), line);
  }
  const v = value(); ws();
  if (i !== text.length) throw new YamlError('متن اضافه پس از مقدار.', line);
  return v;
}

function setKey(obj, key, value, line) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new YamlError('کلید غیرمجاز: ' + key, line);
  if (Object.prototype.hasOwnProperty.call(obj, key)) throw new YamlError('کلید تکراری: ' + key, line);
  obj[key] = value;
}

function parseInlineValue(rest, line) {
  const t = rest.trim();
  if (t[0] === '[' || t[0] === '{') return parseFlow(t, line);
  return parseScalar(t, line);
}

function splitKey(text, line) {
  let key, rest;
  if (text[0] === '"' || text[0] === "'") {
    const q = text[0]; let i = 1;
    while (i < text.length && text[i] !== q) { if (q === '"' && text[i] === '\\') i++; i++; }
    key = parseScalar(text.slice(0, i + 1), line);
    rest = text.slice(i + 1);
    if (!/^\s*:(\s|$)/.test(rest)) return null;
    rest = rest.replace(/^\s*:/, '');
  } else {
    const m = /^([^\s:#][^:]*?)\s*:(?:\s+|$)(.*)$/.exec(text);
    if (!m) return null;
    key = m[1]; rest = m[2];
  }
  return { key: String(key), rest };
}

function parse(source) {
  if (typeof source !== 'string') throw new YamlError('ورودی YAML باید متن باشد.', 0);
  const raw = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (let n = 0; n < raw.length; n++) {
    if (/\t/.test(raw[n].match(/^\s*/)[0])) throw new YamlError('تورفتگی با Tab مجاز نیست.', n + 1);
    if (/^(---|\.\.\.)\s*$/.test(raw[n])) throw new YamlError('چند سند در یک فایل پشتیبانی نمی‌شود.', n + 1);
    lines.push({ n: n + 1, raw: raw[n], text: stripComment(raw[n]).replace(/\s+$/, '') });
  }
  let pos = 0;
  const skip = () => { while (pos < lines.length && lines[pos].text.trim() === '') pos++; };
  const indentOf = l => l.text.match(/^ */)[0].length;

  function block(indent) {
    skip();
    if (pos >= lines.length) return null;
    const l = lines[pos], ind = indentOf(l);
    if (ind < indent) return null;
    const body = l.text.slice(ind);
    if (body === '-' || body.startsWith('- ')) return sequence(ind);
    return mapping(ind);
  }
  function literal(parentIndent) {
    const out = []; let ind = null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.raw.trim() === '') { out.push(''); pos++; continue; }
      const li = l.raw.match(/^ */)[0].length;
      if (li <= parentIndent) break;
      if (ind === null) ind = li;
      if (li < ind) break;
      out.push(l.raw.slice(ind)); pos++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }
  function valueAfter(rest, indent, line) {
    const t = rest.trim();
    if (t === '|' || t === '|-') { const s = literal(indent); return t === '|-' ? s.replace(/\n$/, '') : s; }
    if (t === '') { const v = block(indent + 1); return v; }
    return parseInlineValue(t, line);
  }
  function mapping(indent) {
    const out = {};
    for (;;) {
      skip();
      if (pos >= lines.length) break;
      const l = lines[pos], ind = indentOf(l);
      if (ind < indent) break;
      if (ind > indent) throw new YamlError('تورفتگی نامعتبر.', l.n);
      const body = l.text.slice(ind);
      if (body.startsWith('- ')) break;
      const kv = splitKey(body, l.n);
      if (!kv) throw new YamlError('سطر YAML باید «کلید: مقدار» باشد.', l.n);
      pos++;
      setKey(out, kv.key, valueAfter(kv.rest, indent, l.n), l.n);
    }
    return out;
  }
  function sequence(indent) {
    const out = [];
    for (;;) {
      skip();
      if (pos >= lines.length) break;
      const l = lines[pos], ind = indentOf(l);
      if (ind < indent) break;
      if (ind > indent) throw new YamlError('تورفتگی نامعتبر در فهرست.', l.n);
      const body = l.text.slice(ind);
      if (!(body === '-' || body.startsWith('- '))) break;
      const item = body.slice(1).replace(/^ +/, '');
      const itemIndent = ind + (body.length - body.slice(1).replace(/^ +/, '').length);
      if (item === '') { pos++; out.push(block(ind + 1)); continue; }
      const kv = splitKey(item, l.n);
      if (kv && item[0] !== '[' && item[0] !== '{') {
        // A mapping that starts on the dash line: rewrite this line as the mapping's first line.
        lines[pos] = { n: l.n, raw: ' '.repeat(itemIndent) + item, text: ' '.repeat(itemIndent) + item };
        out.push(mapping(itemIndent));
      } else {
        pos++;
        out.push(valueAfter(item, ind, l.n));
      }
    }
    return out;
  }
  const result = block(0);
  skip();
  if (pos < lines.length) throw new YamlError('ساختار YAML نامعتبر است.', lines[pos].n);
  return result === null ? {} : result;
}

const PLAIN = /^[^\s\-?:,\[\]{}#&*!|>'"%@`][^:#]*$/;
function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '' || !PLAIN.test(s) || /\s$/.test(s) || /^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/.test(s) || /[\n\r\t]/.test(s)) return JSON.stringify(s);
  return s;
}
function flowScalar(v) { const s = scalar(v); return typeof v === 'string' && s === v && /[,[\]{}]/.test(v) ? JSON.stringify(v) : s; }
function key(k) { return /^[A-Za-z0-9_-]+$/.test(k) && !/^\d/.test(k) ? k : JSON.stringify(k); }
function isFlatList(v) { return Array.isArray(v) && v.every(x => x === null || typeof x !== 'object'); }

function stringify(value, indent) {
  indent = indent || 0;
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]\n';
    return value.map(item => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length) {
        const inner = stringify(item, indent + 2);
        return pad + '- ' + inner.slice(indent + 2);
      }
      if (Array.isArray(item)) return pad + '- ' + (isFlatList(item) ? '[' + item.map(flowScalar).join(', ') + ']' : JSON.stringify(item)) + '\n';
      return pad + '- ' + scalar(item) + '\n';
    }).join('');
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).filter(k => value[k] !== undefined).map(k => {
      const v = value[k];
      if (Array.isArray(v)) {
        if (isFlatList(v) && v.length <= 8 && v.every(x => typeof x !== 'string' || (x.length < 40 && !/\s/.test(x)))) return pad + key(k) + ': [' + v.map(flowScalar).join(', ') + ']\n';
        if (!v.length) return pad + key(k) + ': []\n';
        return pad + key(k) + ':\n' + stringify(v, indent + 2);
      }
      if (v !== null && typeof v === 'object') return Object.keys(v).length ? pad + key(k) + ':\n' + stringify(v, indent + 2) : pad + key(k) + ': {}\n';
      return pad + key(k) + ': ' + scalar(v) + '\n';
    }).join('');
  }
  return pad + scalar(value) + '\n';
}

module.exports = { parse, stringify, YamlError };
