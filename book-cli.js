'use strict';
const fs = require('node:fs');
const path = require('node:path');
const E = require('./src/engine.js');
const SDK = require('./src/sdk.js');
const { makeTemplate, verifyTemplate } = require('./tools/kit-builder.js');
const args = process.argv.slice(2), force = args.includes('--force'), positional = args.filter(x => x !== '--force');
const command = positional[0], input = positional[1], output = positional[2];
function read(file) {
  if (!file) throw new Error('مسیر فایل ورودی لازم است.');
  const raw = fs.readFileSync(file, 'utf8');
  if (/\.html?$/i.test(file)) {
    if (/(?:^|\r?\n)[ \t]*<script type="application\/json" id="book-spec">/.test(raw)) return verifyTemplate(raw);
    return SDK.extractHtml(raw);
  }
  return SDK.parseInput(raw);
}
function write(file, text) {
  if (!file) throw new Error('مسیر خروجی لازم است.');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
}
try {
  if (!['validate', 'build', 'editable', 'extract', 'prompt', 'init'].includes(command)) {
    console.log('BookEngine ' + E.VERSION + '\nnode book-cli.js validate BOOK.json\nnode book-cli.js build BOOK.json book.html\nnode book-cli.js editable BOOK.json editable-book.html\nnode book-cli.js extract book.html project.json\nnode book-cli.js prompt BOOK.json authoring-prompt.txt\nnode book-cli.js init new-BOOK.json\nUse --force to replace an existing output.');
    if (command) process.exitCode = 2;
  } else if (command === 'init') {
    const starter = fs.readFileSync(path.join(__dirname, 'ai-kit', 'BOOK-starter.json'), 'utf8');
    write(input, starter);
    console.log(JSON.stringify({ ok: true, output: path.resolve(input) }));
  } else {
    const p = read(input), report = SDK.inspect(p);
    if (command === 'build') write(output, E.renderBook(p));
    if (command === 'editable') write(output, makeTemplate(SDK.toBookSpec(p)));
    if (command === 'extract') write(output, E.serializeProject(p));
    if (command === 'prompt') write(output, SDK.makePrompt(p, '', 'json'));
    console.log(JSON.stringify({ ok: true, command, output: output ? path.resolve(output) : null, report }, null, 2));
  }
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.code === 'EEXIST' ? 'فایل خروجی وجود دارد؛ برای جایگزینی آگاهانه --force اضافه کنید.' : err.message }, null, 2));
  process.exitCode = 1;
}
