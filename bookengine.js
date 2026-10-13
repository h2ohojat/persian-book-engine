#!/usr/bin/env node
'use strict';
// BookEngine 0.3 CLI for project folders. book-cli.js still handles BOOK v1 files.
const fs = require('node:fs');
const path = require('node:path');
const BE = require('./src/v3/index.js');
const SDK = require('./src/sdk.js');

const argv = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['force', 'json', 'write', 'dry-run', 'no-cache'].includes(k)) flags[k] = true;
    else flags[k] = argv[++i];
  } else pos.push(a);
}
const [command, a1, a2] = pos;
const json = !!flags.json;

function out(obj, human) {
  if (json) console.log(JSON.stringify(obj, null, 2));
  else console.log(human());
}
function fmtFinding(x) {
  return '  ' + (x.severity === 'error' ? '✗' : '!') + ' ' + (x.line ? x.line + ': ' : '') + '[' + x.code + '] ' + x.message + (x.hint ? '  ← ' + x.hint : '');
}
function humanReport(r) {
  const lines = [];
  const groups = {};
  for (const x of r.errors.concat(r.warnings)) (groups[x.file || '-'] = groups[x.file || '-'] || []).push(x);
  for (const [file, list] of Object.entries(groups)) { lines.push(file); for (const x of list) lines.push(fmtFinding(x)); }
  lines.push((r.ok ? 'ساختار معتبر است.' : 'ساختار خطا دارد.') + ' خطا: ' + r.errors.length + '، هشدار: ' + r.warnings.length + '، فصل: ' + r.stats.chapters + '، واژه: ' + r.stats.words);
  return lines.join('\n');
}
const usage = () => [
  'BookEngine ' + BE.VERSION + ' (project contract ' + BE.CONTRACT + ')',
  'node bookengine.js new <dir> [--title …] [--format textbook|workbook|trainer]',
  'node bookengine.js validate <dir> [--chapter id] [--json]',
  'node bookengine.js build <dir> [--chapter id] [--out dist/book.html] [--no-cache]',
  'node bookengine.js outline <dir> [--json]',
  'node bookengine.js add-chapter <dir> --id x --title "…" [--after y] [--part p]',
  'node bookengine.js context <dir> --chapter id [--budget 30000] [--out file]',
  'node bookengine.js ids <dir> [--chapter id] --write',
  'node bookengine.js import <BOOK.json|project.json|book.html> <dir>',
  'node bookengine.js export <dir> <BOOK.json>',
  'Outputs are never replaced without --force.'
].join('\n');

function writeOut(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text, { encoding: 'utf8', flag: flags.force ? 'w' : 'wx' });
}

try {
  switch (command) {
    case 'new': {
      if (!a1) throw new Error('مسیر پوشه لازم است.');
      const dir = BE.newProject(a1, { title: flags.title, format: flags.format, force: flags.force });
      out({ ok: true, command, dir }, () => 'پروژه ساخته شد: ' + dir);
      break;
    }
    case 'validate': {
      const project = BE.loadProject(a1 || '.');
      const r = BE.validate(project, { chapter: flags.chapter });
      out(Object.assign({ command }, r), () => humanReport(r));
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case 'build': {
      const project = BE.loadProject(a1 || '.');
      const r = BE.validate(project, {});
      if (!r.ok) { out(Object.assign({ command }, r), () => humanReport(r)); process.exitCode = 1; break; }
      const target = flags.out || path.join(project.dir, 'dist', flags.chapter ? flags.chapter + '.html' : 'book.html');
      const { html, stats } = BE.renderBook(project, { chapters: flags.chapter ? [flags.chapter] : null, cache: !flags['no-cache'], warnings: r.warnings.filter(w => w.code.startsWith('review.') || w.code.startsWith('quote.')).map(w => w.message) });
      const outIsDefaultDist = !flags.out;
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
      fs.writeFileSync(target, html, { encoding: 'utf8', flag: flags.force || outIsDefaultDist ? 'w' : 'wx' });
      out({ ok: true, command, output: path.resolve(target), render: stats, stats: r.stats, warnings: r.warnings }, () => humanReport(r) + '\nخروجی: ' + path.resolve(target) + ' (رندر: ' + stats.rendered + '، از cache: ' + stats.cached + ')');
      break;
    }
    case 'outline': {
      const project = BE.loadProject(a1 || '.');
      const rows = BE.outlineReport(project);
      out({ ok: true, command, chapters: rows }, () => rows.map(r => String(r.number).padStart(3) + '. ' + r.id.padEnd(24) + ' ' + r.status.padEnd(10) + ' ' + String(r.words).padStart(6) + ' واژه  ' + (r.errors ? r.errors + ' خطا ' : '') + (r.warnings ? r.warnings + ' هشدار ' : '') + ' ' + r.title).join('\n'));
      break;
    }
    case 'add-chapter': {
      const r = BE.addChapter(a1 || '.', { id: flags.id, title: flags.title, after: flags.after, part: flags.part });
      out(Object.assign({ ok: true, command }, r), () => 'فصل افزوده شد: ' + r.file);
      break;
    }
    case 'context': {
      if (!flags.chapter) throw new Error('--chapter لازم است.');
      const project = BE.loadProject(a1 || '.');
      const ctx = BE.buildChapterContext(project, flags.chapter, { budgetTokens: flags.budget ? Number(flags.budget) : undefined });
      if (flags.out) writeOut(flags.out, ctx.text);
      if (json) console.log(JSON.stringify({ ok: true, command, estimatedTokens: ctx.estimatedTokens, budgetTokens: ctx.budgetTokens, overBudget: ctx.overBudget, dropped: ctx.dropped, output: flags.out ? path.resolve(flags.out) : null, text: flags.out ? undefined : ctx.text }, null, 2));
      else console.log(flags.out ? 'context نوشته شد: ' + path.resolve(flags.out) + ' (~' + ctx.estimatedTokens + ' توکن)' : ctx.text);
      break;
    }
    case 'ids': {
      const project = BE.loadProject(a1 || '.');
      const changed = BE.writeIds(project, { chapter: flags.chapter, dryRun: !flags.write });
      out({ ok: true, command, written: !!flags.write, changed }, () => (changed.length ? changed.map(c => c.file + ': ' + c.ids + ' شناسه').join('\n') : 'همهٔ بلوک‌ها شناسهٔ صریح دارند.') + (flags.write ? '' : '\n(پیش‌نمایش؛ برای نوشتن --write بدهید.)'));
      break;
    }
    case 'import': {
      if (!a1 || !a2) throw new Error('import <BOOK.json> <dir>');
      const raw = fs.readFileSync(a1, 'utf8');
      const v1 = /\.html?$/i.test(a1) ? SDK.extractHtml(raw) : SDK.parseInput(raw);
      const { files, warnings } = BE.importV1(v1);
      const dir = BE.writeFiles(a2, files, flags.force);
      const r = BE.validate(BE.loadProject(dir), {});
      out({ ok: true, command, dir, files: Object.keys(files).length, warnings, validation: { ok: r.ok, errors: r.errors, warnings: r.warnings.length } }, () => 'پروژه ساخته شد: ' + dir + '\n' + warnings.map(w => '  ! ' + w.message).join('\n') + '\n' + humanReport(r));
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case 'export': {
      if (!a1 || !a2) throw new Error('export <dir> <BOOK.json>');
      const project = BE.loadProject(a1);
      const r = BE.validate(project, {});
      if (!r.ok) { out(Object.assign({ command }, r), () => humanReport(r)); process.exitCode = 1; break; }
      const { project: v1, warnings } = BE.exportV1(project);
      writeOut(a2, JSON.stringify(SDK.toBookSpec(v1), null, 2) + '\n');
      out({ ok: true, command, output: path.resolve(a2), warnings }, () => 'BOOK v1 نوشته شد: ' + path.resolve(a2) + '\n' + warnings.map(w => '  ! ' + w.message).join('\n'));
      break;
    }
    default:
      console.log(usage());
      if (command) process.exitCode = 2;
  }
} catch (err) {
  const message = err.code === 'EEXIST' ? 'خروجی وجود دارد؛ برای جایگزینی آگاهانه --force اضافه کنید.' : err.message;
  if (json) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error('خطا: ' + message);
  process.exitCode = 1;
}
