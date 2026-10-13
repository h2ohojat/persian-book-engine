'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const E = require('../src/engine.js');
const SDK = require('../src/sdk.js');
const root = path.resolve(__dirname, '..');
const inlineScript = text => text.replace(/<\/script/gi, '<\\/script');
const inlineJson = value => JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function makeTemplate(spec) {
  SDK.compileBookSpec(spec);
  const engine = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');
  const sdk = fs.readFileSync(path.join(root, 'src', 'sdk.js'), 'utf8');
  return '<!doctype html>\n<html lang="fa" dir="rtl">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>قالب کتاب BookEngine</title></head>\n<body>\n' +
    '<!-- هوش مصنوعی فقط JSON این بخش را جایگزین می‌کند. -->\n<!-- BOOK_ENGINE_DATA_BEGIN -->\n<script type="application/json" id="book-spec">\n' + inlineJson(spec) + '\n</script>\n<!-- BOOK_ENGINE_DATA_END -->\n' +
    '<noscript>برای نمایش این قالب، JavaScript را فعال کنید. برای فایل بدون JavaScript از خروجی build استفاده کنید.</noscript>\n<script>\n' + inlineScript(engine) + '\n</script>\n<script>\n' + inlineScript(sdk) + '\n</script>\n<script>\n' +
    '(function(){function boot(){try{var p=BookSDK.parseInput(document.getElementById("book-spec").textContent);var result=BookEngine.renderBook(p);document.open();document.write(result);document.close()}catch(error){document.body.replaceChildren();var box=document.createElement("main");box.style.cssText="max-width:800px;margin:50px auto;padding:25px;font:16px/2 Tahoma;white-space:pre-wrap;color:#823f35";box.textContent="دادهٔ کتاب معتبر نیست. بخش book-spec را اصلاح کنید.\\n"+error.message;document.body.append(box)}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot()})();\n</script>\n</body>\n</html>\n';
}
function verifyTemplate(raw) {
  const p = SDK.extractHtml(raw);
  const normalize = text => text.replace(/\r\n/g, '\n').trim().replace(/(<script type="application\/json" id="book-spec">\n)[\s\S]*?(\n<\/script>)/, '$1__BOOK_DATA__$2');
  if (normalize(raw) !== normalize(makeTemplate(SDK.toBookSpec(p)))) throw new Error('کد قالب خارج از بخش BOOK تغییر کرده است. از قالب اصلی شروع کنید یا editable را برای ساخت قالب سالم اجرا کنید.');
  return p;
}
function buildKit() {
  const directory = path.join(root, 'ai-kit');
  fs.mkdirSync(directory, { recursive: true });
  const starter = JSON.parse(fs.readFileSync(path.join(directory, 'BOOK-starter.json'), 'utf8'));
  const template = makeTemplate(starter);
  fs.writeFileSync(path.join(directory, 'book-template.html'), template, 'utf8');
  const guide = fs.readFileSync(path.join(directory, 'AUTHORING-GUIDE.fa.txt'), 'utf8');
  const schema = JSON.parse(fs.readFileSync(path.join(directory, 'BOOK.schema.json'), 'utf8'));
  const prompt = SDK.makePrompt(SDK.compileBookSpec(starter), 'موضوع، مخاطب، منابع و اندازهٔ کتاب را از مؤلف بگیر و مطابق قرارداد کتاب را بساز.', 'json');
  const htmlPrompt = SDK.makePrompt(SDK.compileBookSpec(starter), 'موضوع، مخاطب، منابع و اندازهٔ کتاب را از مؤلف بگیر و مطابق قرارداد کتاب را بساز.', 'html');
  const data = { engineVersion: E.VERSION, starter, template, guide, schema, prompt, htmlPrompt };
  const page = fs.readFileSync(path.join(root, 'tools', 'kit-shell.html'), 'utf8').replace('<!-- KIT_DATA -->', '<script>\nwindow.AIKitData=' + inlineJson(data) + ';\n</script>');
  fs.writeFileSync(path.join(directory, '01-ai-kit.html'), page, 'utf8');
  const hashes = {};
  for (const file of ['src/engine.js', 'src/sdk.js', 'ai-kit/BOOK.schema.json']) hashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ product: 'BookEngine', engineVersion: E.VERSION, contractVersion: SDK.CONTRACT_VERSION, formats: Object.keys(E.FORMATS), blockTypes: E.TYPES, sha256: hashes, files: ['01-ai-kit.html', 'book-template.html', 'BOOK-starter.json', 'BOOK.schema.json', 'AUTHORING-GUIDE.fa.txt'] }, null, 2), 'utf8');
  return { directory, engineVersion: E.VERSION, templateBytes: Buffer.byteLength(template), kitBytes: Buffer.byteLength(page) };
}
if (require.main === module) console.log(JSON.stringify(buildKit(), null, 2));
module.exports = { makeTemplate, verifyTemplate, buildKit };
