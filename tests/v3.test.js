'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const E = require('../src/engine.js');
const SDK = require('../src/sdk.js');
const BE = require('../src/v3/index.js');
const YAML = require('../src/v3/yaml.js');

const root = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bookengine-v3-'));
const SAMPLES = ['data/sample-book.json', 'examples/BOOK-three-chapters.json', 'books/ai-test/BOOK.json'];
const readV1 = f => SDK.parseInput(fs.readFileSync(path.join(root, f), 'utf8'));
function project(files) {
  const dir = tmp();
  const base = {
    'book.yaml': 'bookEngine: 3\nid: demo\ntitle: کتاب آزمایشی\nauthors: [مؤلف]\nformat: textbook\n',
    'outline.yaml': 'chapters:\n  - id: one\n    file: chapters/01-one.md\n',
    'sources/sources.json': JSON.stringify([{ id: 'src-eco', title: 'منبع', verified: true, verifiedBy: 'مؤلف' }]),
    'sources/excerpts/src-eco.txt': 'متن دقیق منبع برای آزمون.',
    'fiches/fiches.jsonl': JSON.stringify({ id: 'f1', kind: 'quote', sourceId: 'src-eco', text: 'متن دقیق منبع', locator: 'ص ۱' }) + '\n',
    'memory/glossary.yaml': 'terms:\n  - id: fiche\n    term: فیش\n    definition: یادداشت پژوهشی\n'
  };
  BE.writeFiles(dir, Object.assign(base, files), true);
  return dir;
}
const chapter = body => '---\nid: one\ntitle: فصل یک\nfiches: [f1]\n---\n\n' + body;
const codes = r => r.errors.map(e => e.code);
const strip = h => h.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<div class="reviewNotice">[\s\S]*?<\/div>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('YAML subset parses and round-trips; unsafe features are refused', () => {
  const v = { a: 'x: y', list: ['a, b', 'c'], n: { '1': 'line\nnext' }, num: [1, 2], empty: [], fa: 'ص ۴۵' };
  assert.deepEqual(YAML.parse(YAML.stringify(v)), v);
  assert.deepEqual(YAML.parse('a: |\n  one\n  two\nb: [1, "x"]\n'), { a: 'one\ntwo\n', b: [1, 'x'] });
  assert.throws(() => YAML.parse('a: &x 1\nb: *x\n'), /پشتیبانی/);
  assert.throws(() => YAML.parse('a: 1\na: 2\n'), /تکراری/);
  assert.throws(() => YAML.parse('__proto__: 1\n'), /غیرمجاز/);
});

test('BOOK v1 → 0.3 → v1 round-trip keeps the data for every sample', () => {
  for (const f of SAMPLES) {
    const v1 = readV1(f), dir = tmp();
    BE.writeFiles(dir, BE.importV1(v1).files);
    const r = BE.validate(BE.loadProject(dir));
    assert.equal(r.ok, true, f + ': ' + JSON.stringify(r.errors));
    const back = BE.exportV1(BE.loadProject(dir)).project;
    assert.deepEqual(SDK.toBookSpec(back), SDK.toBookSpec(v1), f);
    for (const s of v1.sources) assert.equal(back.sources.find(x => x.id === s.id).verified, s.verified);
  }
});

test('0.3 HTML matches 0.2 text and structure in all three formats', () => {
  for (const f of SAMPLES) for (const format of ['textbook', 'workbook', 'trainer']) {
    const v1 = readV1(f); v1.metadata.format = format;
    const dir = tmp();
    BE.writeFiles(dir, BE.importV1(v1).files);
    const old = E.renderBook(v1), neu = BE.renderBook(BE.loadProject(dir), { cache: false }).html;
    assert.equal(strip(neu), strip(old), f + ' ' + format);
    for (const cls of ['class="chapter"', 'class="exercise"', 'class="quote"', 'class="callout"', 'class="response"', 'class="reference"', 'class="cite"']) {
      assert.equal(neu.split(cls).length, old.split(cls).length, f + ' ' + format + ' ' + cls);
    }
  }
});

test('new features: parts, sections, table, footnote, term, cite, xref render safely', () => {
  const dir = project({
    'outline.yaml': 'parts:\n  - id: part-a\n    title: مبانی\n    chapters:\n      - id: one\n        file: chapters/01-one.md\n        status: approved\n        approvedBy: مؤلف\n',
    'chapters/01-one.md': chapter([
      '## فیش چیست؟ {#what}', '',
      'فیش به *منبع* و **شاهد** وصل است [@src-eco; ص ۱]. اصطلاح {term:fiche} را ببینید.^[پانویس آزمایشی.]',
      'نگاه کنید به [](#ref:sorting) و [فصل](#ref:one).', '',
      '### مرتب‌سازی {#sorting}', '',
      '| ستون | مقدار |', '| --- | --- |', '| الف | ۱ |', '',
      ':::quote {#q1 source=src-eco locator="ص ۱"}', 'متن دقیق منبع', ':::', '',
      ':::exercise {#ex1 lines=3}', 'یک تمرین.', '', '::rubric[معیار *روشن*.]', ':::', '',
      '<script>alert(1)</script> و [بد](javascript:alert(1))'
    ].join('\n'))
  });
  const p = BE.loadProject(dir), r = BE.validate(p);
  assert.deepEqual(codes(r), ['syntax.link']);
  const html = BE.renderBook(p, { cache: false }).html;
  for (const s of ['<section class="part" id="n-part-a">', '<h3>فیش چیست؟</h3>', '<h4>مرتب‌سازی</h4>', '<table>', '<em>منبع</em>', '<strong>شاهد</strong>', 'class="fnref"', 'id="fn-one-1"', 'href="#term-fiche"', 'id="glossary"', 'href="#n-sorting">مرتب‌سازی</a>', 'href="#chapter-one">فصل</a>', 'class="inlineCite"', 'معیار بررسی: معیار <em>روشن</em>']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('errors are machine-readable with code, file, line and hints', () => {
  const dir = project({
    'chapters/01-one.md': chapter([
      'متن [@src-ecco; ص ۱] و {term:nope} و [x](#ref:missing).', '',
      ':::quote {#q1 source=src-eco}', 'متن', ':::', '',
      ':::callout', 'بدون شناسه', ':::', '',
      ':::unknown {#u1}', 'x', ':::', '',
      ':::exercise {#ex1 lines=20 color=red}', 'x', ':::', '',
      '## تیتر بدون شناسه', '',
      ':::callout {#open}', 'باز مانده'
    ].join('\n'))
  });
  const r = BE.validate(BE.loadProject(dir));
  const c = codes(r);
  for (const code of ['ref.unknown-source', 'ref.unknown-term', 'ref.unknown-target', 'quote.locator', 'id.missing', 'block.unknown-type', 'block.attribute', 'syntax.directive']) assert.ok(c.includes(code), code + ' in ' + c.join(','));
  const cite = r.errors.find(e => e.code === 'ref.unknown-source');
  assert.equal(cite.file, 'chapters/01-one.md');
  assert.equal(cite.line, 7);
  assert.equal(cite.hint, 'شاید src-eco');
  assert.ok(r.errors.filter(e => e.code === 'block.attribute').length >= 2);
});

test('duplicate ids across chapters, bad frontmatter and unknown fiche are reported', () => {
  const dir = project({
    'outline.yaml': 'chapters:\n  - id: one\n    file: chapters/01-one.md\n  - id: two\n    file: chapters/02-two.md\n',
    'chapters/01-one.md': chapter('{#same}\nمتن.\n'),
    'chapters/02-two.md': '---\nid: wrong\ntitle: دو\nfiches: [nope]\nextra: 1\n---\n\n{#same}\nمتن.\n'
  });
  const c = codes(BE.validate(BE.loadProject(dir)));
  for (const code of ['id.duplicate', 'chapter.id-mismatch', 'ref.unknown-fiche', 'schema.additionalProperties']) assert.ok(c.includes(code), code);
});

test('ids --write adds stable ids that survive reordering', () => {
  const dir = project({ 'chapters/01-one.md': chapter('## تیتر\n\nپاراگراف اول.\n\n{source=src-eco}\nپاراگراف دوم.\n\n:::callout\nنکته.\n:::\n') });
  let p = BE.loadProject(dir);
  assert.ok(codes(BE.validate(p)).includes('id.missing'));
  const before = []; require('../src/v3/project.js').walk(p.chapter('one').children, n => before.push(n.id));
  BE.writeIds(p);
  p = BE.loadProject(dir);
  const r = BE.validate(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const after = []; require('../src/v3/project.js').walk(p.chapter('one').children, n => after.push(n.id));
  assert.deepEqual(after, before);
  assert.deepEqual(BE.writeIds(p), []);
});

test('a 50-chapter book validates, builds, rebuilds incrementally and keeps context bounded', () => {
  const dir = tmp();
  BE.newProject(dir, { force: true, title: 'کتاب بزرگ' });
  const para = 'این یک پاراگراف آزمایشی برای سنجش مقیاس‌پذیری موتور کتاب است که چند بار تکرار می‌شود. '.repeat(12);
  const outline = { chapters: [] };
  for (let i = 1; i <= 50; i++) {
    const id = 'ch' + i, file = 'chapters/' + String(i).padStart(2, '0') + '-' + id + '.md';
    outline.chapters.push({ id, file, status: 'drafted' });
    let body = '---\nid: ' + id + '\ntitle: فصل ' + i + '\n---\n\n';
    for (let s = 1; s <= 5; s++) body += '## بخش ' + s + ' {#' + id + '-s' + s + '}\n\n' + (para + '\n\n').repeat(4) + ':::exercise {#' + id + '-x' + s + '}\nتمرین.\n:::\n\n';
    fs.writeFileSync(path.join(dir, file), body);
    fs.mkdirSync(path.join(dir, 'memory', 'summaries'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory', 'summaries', id + '.md'), 'خلاصهٔ فصل ' + i + '. '.repeat(30));
  }
  fs.rmSync(path.join(dir, 'chapters', '01-intro.md'));
  fs.writeFileSync(path.join(dir, 'outline.yaml'), YAML.stringify(outline));
  let p = BE.loadProject(dir);
  const r = BE.validate(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
  assert.ok(r.stats.words > 150000, 'words ' + r.stats.words);
  const first = BE.renderBook(p);
  assert.equal(first.stats.rendered, 50);
  fs.appendFileSync(path.join(dir, 'chapters', '07-ch7.md'), '\nپاراگراف تازه.\n');
  p = BE.loadProject(dir);
  const second = BE.renderBook(p);
  assert.deepEqual(second.stats, { rendered: 1, cached: 49 });
  assert.ok(second.html.includes('پاراگراف تازه.'));
  fs.appendFileSync(path.join(dir, 'chapters', '03-ch3.md'), '\nیک تغییر دیگر.\n');
  const one = BE.validate(BE.loadProject(dir), { chapter: 'ch50' });
  assert.equal(one.ok, true);
  assert.equal(one.stats.checkedChapters, 1);
  assert.deepEqual([one.stats.indexParsed, one.stats.indexCached], [1, 49]);
  const ctx = BE.buildChapterContext(BE.loadProject(dir), 'ch50', { budgetTokens: 30000 });
  assert.ok(ctx.estimatedTokens <= 30000, String(ctx.estimatedTokens));
  assert.ok(ctx.text.includes('خلاصهٔ فصل 49'));
});

test('add-chapter, new and CLI outputs refuse to overwrite without --force', () => {
  const dir = tmp();
  const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bookengine.js'), ...args], { encoding: 'utf8' });
  JSON.parse(cli('new', dir, '--json', '--force'));
  BE.addChapter(dir, { id: 'two', title: 'دوم', after: 'intro' });
  assert.deepEqual(BE.loadProject(dir).chapters.map(c => c.id), ['intro', 'two']);
  assert.throws(() => BE.addChapter(dir, { id: 'two', title: 'x' }), /وجود دارد/);
  assert.throws(() => cli('new', dir), /--force/);
  const report = JSON.parse(cli('validate', dir, '--json'));
  assert.equal(report.ok, true);
  assert.ok(report.warnings.some(w => w.code === 'content.placeholder'));
  const out = path.join(dir, 'out.json');
  JSON.parse(cli('export', dir, out, '--json'));
  assert.throws(() => cli('export', dir, out), /--force/);
  const spec = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(spec.bookSpecVersion, 1);
  assert.equal(SDK.compileBookSpec(spec).chapters.length, 2);
});

test('import from v0.2 reading HTML and build through the CLI', () => {
  const dir = tmp(), target = path.join(dir, 'book');
  const cli = (...args) => execFileSync(process.execPath, [path.join(root, 'bookengine.js'), ...args], { encoding: 'utf8' });
  const r = JSON.parse(cli('import', path.join(root, 'books/ai-test/book.html'), target, '--json'));
  assert.equal(r.validation.ok, true);
  const b = JSON.parse(cli('build', target, '--json'));
  assert.ok(fs.readFileSync(b.output, 'utf8').includes('<main class="book">'));
  assert.deepEqual(b.render, { rendered: 3, cached: 0 });
  assert.deepEqual(JSON.parse(cli('build', target, '--json')).render, { rendered: 0, cached: 3 });
});

test('paths in outline cannot escape the project folder', () => {
  const dir = project({ 'outline.yaml': 'chapters:\n  - id: one\n    file: ../secret.md\n' });
  const r = BE.validate(BE.loadProject(dir));
  assert.ok(codes(r).includes('schema.pattern'));
});
