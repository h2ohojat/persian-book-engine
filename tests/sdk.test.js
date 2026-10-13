'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const E = require('../src/engine.js');
const SDK = require('../src/sdk.js');
const { makeTemplate, verifyTemplate } = require('../tools/kit-builder.js');
const sample = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/BOOK-three-chapters.json'), 'utf8'));
const starter = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../ai-kit/BOOK-starter.json'), 'utf8'));

test('minimal BOOK compiles with defaults and stable bounded IDs', () => {
  const spec = { bookSpecVersion: 1, metadata: { title: 'کتاب من' }, chapters: [{ title: 'فصل اول', blocks: [{ type: 'paragraph', text: 'متن فارسی' }] }] };
  const p = SDK.compileBookSpec(spec, { now: '2026-10-13T12:00:00.000Z' });
  assert.equal(E.validateProject(p).ok, true);
  assert.equal(p.metadata.format, 'textbook');
  assert.deepEqual(p.workflow, { completed: [], notes: {} });
  assert.deepEqual(SDK.compileBookSpec(spec, { now: p.createdAt }), p);
  spec.chapters[0].id = 'a'.repeat(80);
  assert.equal(E.validateProject(SDK.compileBookSpec(spec)).ok, true);
});
test('canonical BOOK preserves authoring data when compiled', () => {
  const spec = sample(), p = SDK.compileBookSpec(spec);
  assert.deepEqual(SDK.toBookSpec(p), spec);
  assert.equal(SDK.inspect(p).warnings.length, 0);
});
test('new sources default to unverified and invalid quotes are rejected', () => {
  const spec = sample(); delete spec.sources[0].verified;
  assert.equal(SDK.compileBookSpec(spec).sources[0].verified, false);
  for (const change of [
    s => s.chapters[0].blocks[1].sourceId = 'invented',
    s => s.chapters[0].blocks[1].locator = '',
    s => s.fiches[0].locator = '',
    s => s.fiches[0].sourceId = null,
    s => s.sources[0].url = 'javascript:alert(1)'
  ]) { const bad = sample(); change(bad); assert.throws(() => SDK.compileBookSpec(bad)); }
});
test('unknown fields, executable block types, empty books and malformed lists are rejected', () => {
  for (const change of [
    s => s.customCode = 'run()',
    s => s.metadata.language = 'en',
    s => s.chapters = [],
    s => s.chapters[0].blocks = [],
    s => s.chapters[0].blocks[0].type = 'custom',
    s => s.chapters[0].blocks[0].html = '<script>',
    s => s.chapters[0].blocks[0] = { type: 'list', items: null },
    s => s.sources = null
  ]) { const bad = sample(); change(bad); assert.throws(() => SDK.compileBookSpec(bad)); }
});
test('reading HTML can restore book content without private research and workflow notes', () => {
  const p = SDK.compileBookSpec(sample());
  p.workflow.notes['1'] = 'PRIVATE_WORKFLOW_TOKEN';
  p.fiches.push({ id: 'private-fiche', kind: 'author', sourceId: null, text: 'PRIVATE_FICHE_TOKEN', locator: '', keywords: '' });
  p.sources[0].excerpt += '\nPRIVATE_SOURCE_TOKEN';
  const html = E.renderBook(p), restored = SDK.extractHtml(html);
  assert.deepEqual(restored, E.readingProject(p));
  assert.ok(!html.includes('PRIVATE_WORKFLOW_TOKEN'));
  assert.ok(!html.includes('PRIVATE_FICHE_TOKEN'));
  assert.ok(!html.includes('PRIVATE_SOURCE_TOKEN'));
});
test('HTML data extraction never executes surrounding code and refuses ambiguous data', () => {
  const p = SDK.compileBookSpec(sample()), html = E.renderBook(p);
  const hostile = html.replace('</head>', '<script>throw new Error("executed");globalThis.SDK_EXECUTED=true;</script></head>');
  assert.equal(SDK.extractHtml(hostile).metadata.title, p.metadata.title);
  assert.equal(globalThis.SDK_EXECUTED, undefined);
  assert.throws(() => SDK.extractHtml(html.replace('</head>', E.projectDataHtml(p) + '</head>')));
  assert.throws(() => SDK.extractHtml('<html><body>no book data</body></html>'));
});
test('editable template carries only editable data plus fixed engine and SDK', () => {
  const spec = sample(), html = makeTemplate(spec), parsed = SDK.extractHtml(html);
  assert.deepEqual(SDK.toBookSpec(parsed), spec);
  assert.ok(html.includes('BOOK_ENGINE_DATA_BEGIN'));
  assert.ok(html.includes("const VERSION = '0.2.0'"));
  spec.chapters[0].blocks[0].text = '</script><script>window.BAD=1</script> & متن';
  const escaped = makeTemplate(spec);
  assert.ok(!escaped.includes('</script><script>window.BAD'));
  assert.equal(SDK.extractHtml(escaped).chapters[0].blocks[0].text, spec.chapters[0].blocks[0].text);
});
test('editable HTML validation accepts changed BOOK data and rejects changed runtime code', () => {
  const spec = sample(), html = makeTemplate(spec);
  assert.equal(verifyTemplate(html.replace(/\n/g, '\r\n')).metadata.title, spec.metadata.title);
  assert.throws(() => verifyTemplate(html.replace("const VERSION = '0.2.0'", "const VERSION = 'tampered'")), /قالب/);
  assert.throws(() => verifyTemplate(html.replace('</body>', '<script>alert(1)</script></body>')), /قالب/);
});
test('quote checking distinguishes text mismatch from structural validity', () => {
  const spec = sample(); spec.chapters[0].blocks[1].text = 'این نقل‌قول در منبع وجود ندارد.';
  const p = SDK.compileBookSpec(spec);
  assert.equal(E.validateProject(p).ok, true);
  assert.ok(SDK.inspect(p).warnings.some(w => w.includes('تطبیق پیدا نکرد')));
});
test('whole-book prompt has the chosen output mode, project context and factual limits', () => {
  const p = SDK.compileBookSpec(sample());
  const json = SDK.makePrompt(p, 'کتاب سه‌فصلی برای مربیان بساز', 'json');
  const html = SDK.makePrompt(p, 'درخواست تست', 'html');
  assert.ok(json.includes('فقط یک فایل BOOK.json'));
  assert.ok(html.includes('HTML تک‌فایلی'));
  assert.ok(json.includes('verified:false'));
  assert.ok(json.includes('bookSpecVersion'));
  assert.ok(json.includes('fiche-audience'));
});
test('input accepts both legacy project and BOOK; UTF-8 byte size is enforced', () => {
  const p = SDK.compileBookSpec(sample());
  assert.deepEqual(SDK.parseInput('\uFEFF' + E.serializeProject(p)), p);
  assert.equal(SDK.parseInput(JSON.stringify(sample())).chapters.length, 3);
  assert.throws(() => SDK.parseInput('ب'.repeat(1000001)), /۲ مگابایت/);
});
test('CLI validates, builds, extracts and refuses to overwrite existing files', () => {
  const tempParent = path.resolve(os.tmpdir());
  const tmp = fs.mkdtempSync(path.join(tempParent, 'book-sdk-test-'));
  const input = path.join(__dirname, '../examples/BOOK-three-chapters.json'), output = path.join(tmp, 'book.html'), extracted = path.join(tmp, 'project.json');
  const cli = path.join(__dirname, '../book-cli.js');
  const run = args => spawnSync(process.execPath, [cli].concat(args), { encoding: 'utf8' });
  try {
    assert.equal(run(['validate', input]).status, 0);
    assert.equal(run(['build', input, output]).status, 0);
    const before = fs.readFileSync(output, 'utf8');
    const overwrite = run(['build', input, output]);
    assert.equal(overwrite.status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), before);
    assert.equal(run(['extract', output, extracted]).status, 0);
    assert.equal(E.parseProject(fs.readFileSync(extracted, 'utf8')).chapters.length, 3);
    assert.equal(run(['build', input, output, '--force']).status, 0);
  } finally {
    const target = path.resolve(tmp);
    if (path.dirname(target) !== tempParent || !path.basename(target).startsWith('book-sdk-test-')) throw new Error('Unexpected test cleanup target.');
    fs.rmSync(target, { recursive: true, force: true });
  }
});
test('starter is structural input, with a placeholder warning rather than a finished book claim', () => {
  const report = SDK.inspect(SDK.compileBookSpec(starter()));
  assert.ok(report.warnings.some(w => w.includes('جایگزین')));
});
