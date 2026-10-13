(function () {
  'use strict';
  const E = window.BookEngine, SDK = window.BookSDK, $ = id => document.getElementById(id), esc = E.esc;
  const KEY = 'book-engine-project-v1';
  const kinds = { quote: 'نقل‌قول مستقیم', summary: 'خلاصه یا بازنویسی', author: 'برداشت مؤلف' };
  const typeLabels = { paragraph: 'متن', heading: 'تیتر بخش', callout: 'نکته و مثال', exercise: 'تمرین', quote: 'نقل‌قول', list: 'فهرست' };
  const viewInfo = {
    metadata: ['شناسنامه کتاب', 'مخاطب، هدف و قالب کتاب را روشن کنید.'],
    sources: ['منابع و فیش‌ها', 'متن مرجع را ثبت کنید و فیش‌های آن را به فصل‌ها پیوند دهید.'],
    chapters: ['فصل‌ها و محتوا', 'فصل واقعی بسازید؛ هر متن، تیتر و تمرین یک بلوک قابل ویرایش است.'],
    workflow: ['مسیر تألیف', '۱۸ گام از فایل آموزشی، برای راهنمایی و ثبت تصمیم‌های پروژه.'],
    preview: ['پیش‌نمایش و خروجی', 'خروجی مستقل کتاب را ببینید؛ سپس فایل وب یا نسخهٔ چاپی بگیرید.'],
    ai: ['بستهٔ هوش مصنوعی', 'موتور و قرارداد BOOK را به AI بدهید و کل کتاب را تحویل بگیرید.']
  };
  let project, view = 'metadata', selectedChapter, step = 1, editingFiche = null, persisted = true, noticeTimer;
  let storageIssue = '';
  try {
    const raw = localStorage.getItem(KEY);
    project = raw === null ? E.clone(window.BookSample) : E.parseProject(raw);
  } catch (err) {
    project = E.clone(window.BookSample);
    storageIssue = 'اطلاعات قبلی قابل خواندن نیست یا ذخیره مرورگر در دسترس نیست. ' + err.message;
    persisted = false;
  }
  selectedChapter = project.chapters[0] && project.chapters[0].id;
  function notice(message, error) {
    clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').className = 'notice visible' + (error ? ' error' : '');
    noticeTimer = setTimeout(() => $('notice').classList.remove('visible'), error ? 10000 : 5000);
  }
  function saveStatus(message, failed) { $('saveStatus').textContent = message; $('saveStatus').classList.toggle('failed', Boolean(failed)); }
  function commit(refresh) {
    project.updatedAt = new Date().toISOString();
    const validation = E.validateProject(project);
    if (!validation.ok) {
      persisted = false; saveStatus('ذخیره نشده: ورودی را کامل کنید', true);
    } else {
      try {
        localStorage.setItem(KEY, E.serializeProject(project));
        persisted = true; saveStatus('✓ در این مرورگر ذخیره شد', false);
      } catch (_) {
        persisted = false; saveStatus('ذخیره نشد؛ پشتیبان بگیرید', true);
      }
    }
    updateStats();
    if (refresh) render();
  }
  function updateStats() {
    $('sidebarTitle').textContent = project.metadata.title || 'کتاب بی‌عنوان';
    $('formatBadge').textContent = E.FORMATS[project.metadata.format];
    const validation = E.validateProject(project);
    const stats = validation.ok ? SDK.inspect(project) : { words: 0, fiches: project.fiches.length, warnings: validation.errors };
    $('statChapters').textContent = E.fa(project.chapters.length);
    $('statWords').textContent = E.fa(stats.words);
    $('statFiches').textContent = E.fa(stats.fiches);
    $('statWarnings').textContent = E.fa(stats.warnings.length);
    $('progressPill').textContent = E.fa(project.workflow.completed.length) + ' از ۱۸ گام ثبت شده';
  }
  function input(label, name, value, extra) {
    return '<div><label for="' + esc(name) + '">' + esc(label) + '</label><input id="' + esc(name) + '" name="' + esc(name) + '" value="' + esc(value) + '" ' + (extra || '') + '></div>';
  }
  function options(values, selected) {
    return Object.entries(values).map(([key, label]) => '<option value="' + esc(key) + '" ' + (key === selected ? 'selected' : '') + '>' + esc(label) + '</option>').join('');
  }
  function sourceOptions(selected, optional) {
    return (optional ? '<option value="">بدون منبع / تألیفی</option>' : '<option value="">منبع را انتخاب کنید</option>') + project.sources.map(s => '<option value="' + esc(s.id) + '" ' + (s.id === selected ? 'selected' : '') + '>' + esc(s.title) + '</option>').join('');
  }
  function metadataView() {
    const m = project.metadata;
    return '<div class="grid2"><section class="panel"><h3>مشخصات پروژه</h3><div class="fieldGrid">' +
      input('عنوان کتاب', 'title', m.title, 'data-bind="metadata:title" maxlength="500"') +
      input('زیرعنوان', 'subtitle', m.subtitle, 'data-bind="metadata:subtitle" maxlength="500"') +
      input('مؤلف', 'author', m.author, 'data-bind="metadata:author" maxlength="500"') +
      input('مخاطب', 'audience', m.audience, 'data-bind="metadata:audience" maxlength="500"') +
      '<div><label for="format">قالب خروجی</label><select id="format" data-bind="metadata:format">' + options(E.FORMATS, m.format) + '</select></div>' +
      input('نسخه کتاب', 'versionLabel', m.versionLabel, 'data-bind="metadata:versionLabel" maxlength="500"') +
      '<div class="full"><label for="description">هدف و توضیح کتاب</label><textarea id="description" rows="5" maxlength="10000" data-bind="metadata:description">' + esc(m.description) + '</textarea></div></div><p class="hint">تغییرات این بخش و متن فصل‌ها خودکار ذخیره می‌شوند. وضعیت ذخیره را بالای صفحه ببینید.</p></section>' +
      '<section><div class="welcome"><span class="eyebrow" style="color:#9fd5bd">یک مسیر قابل آزمون</span><h3>از یادداشت، یک کتاب بسازید.</h3><p>نمونهٔ حاضر سه فصل، سه فیش و یک منبع تألیفی آزمایشی دارد. عنوان یا یک پاراگراف را تغییر دهید و خروجی تازه بگیرید.</p><button data-go="chapters" class="button">ویرایش فصل‌ها ←</button></div>' +
      '<div class="panel"><h3>سه قالب در همین نسخه</h3><p class="hint"><b>درس‌نامه:</b> توضیح، مثال و تمرین.<br><b>کتاب کار:</b> همان محتوا همراه با فضای نوشتن پاسخ.<br><b>راهنمای مربی:</b> هدف‌ها و فعالیت‌ها با راهنمای عمومی اجرا.</p><p class="hint">خروجی HTML مستقل و فارسی است. چاپ، فقط خود کتاب را صفحه‌بندی می‌کند. اتصال مستقیم AI و خروجی EPUB یا Word در این نسخه آماده نشده‌اند.</p></div></section></div>';
  }
  function sourceForm(s) {
    s = s || { id: '', title: '', creator: '', year: '', locator: '', url: '', excerpt: '', verified: false };
    const prefix = s.id || 'new-source';
    return '<form data-source-form="' + esc(s.id) + '"><div class="fieldGrid">' +
      input('عنوان منبع', prefix + '-title', s.title, 'data-field="title" required maxlength="1000"') +
      input('پدیدآورنده', prefix + '-creator', s.creator, 'data-field="creator" maxlength="1000"') +
      input('سال', prefix + '-year', s.year, 'data-field="year" maxlength="1000"') +
      input('نشانی در منبع', prefix + '-locator', s.locator, 'data-field="locator" maxlength="1000"') +
      '<div class="full">' + input('پیوند منبع، اختیاری', prefix + '-url', s.url, 'data-field="url" type="url" maxlength="1000"') + '</div>' +
      '<div class="full"><label for="' + prefix + '-excerpt">متن مرجع یا گزیدهٔ مورد استفاده</label><textarea id="' + prefix + '-excerpt" data-field="excerpt" maxlength="30000" rows="4">' + esc(s.excerpt) + '</textarea></div></div>' +
      '<label class="checkLabel"><input type="checkbox" data-field="verified" ' + (s.verified ? 'checked' : '') + '> منبع و متن آن را خودم بررسی کرده‌ام</label><div class="toolbar"><button class="button primary" type="submit">' + (s.id ? 'ذخیره تغییرات منبع' : 'ثبت منبع') + '</button>' + (s.id ? '<button class="button danger small" type="button" data-action="delete-source" data-id="' + esc(s.id) + '">حذف منبع</button>' : '') + '</div></form>';
  }
  function sourcesView() {
    const f = project.fiches.find(f => f.id === editingFiche) || { kind: 'summary', sourceId: null, text: '', locator: '', keywords: '' };
    return '<div class="grid2"><section class="panel"><h3>بانک منابع</h3><p class="hint">هر منبع شناسهٔ مستقل دارد. تیک بررسی، تأیید شخصی شماست و صحت علمی را خودکار تضمین نمی‌کند.</p>' +
      project.sources.map(s => '<details class="sourceCard"><summary>' + esc(s.title) + ' ' + (s.verified ? '✓' : '· نیازمند بررسی') + '</summary>' + sourceForm(s) + '</details>').join('') +
      '<details class="sourceCard" open><summary>+ منبع تازه</summary>' + sourceForm() + '</details></section>' +
      '<section class="panel"><h3>' + (editingFiche ? 'ویرایش فیش' : 'ساخت فیش') + '</h3><form id="ficheForm"><label for="ficheKind">نوع فیش</label><select id="ficheKind" name="kind">' + options(kinds, f.kind) + '</select><label for="ficheSource">منبع</label><select id="ficheSource" name="sourceId">' + sourceOptions(f.sourceId, true) + '</select>' +
      '<label for="ficheText">متن فیش</label><textarea id="ficheText" name="text" required maxlength="30000" rows="4">' + esc(f.text) + '</textarea>' +
      input('نشانی دقیق، مانند بند یا صفحه', 'ficheLocator', f.locator, 'data-fiche-field="locator" maxlength="1000"') +
      input('کلیدواژه‌ها', 'ficheKeywords', f.keywords, 'data-fiche-field="keywords" maxlength="1000"') +
      '<div class="toolbar"><button class="button primary" type="submit">' + (editingFiche ? 'ذخیره فیش' : 'ثبت فیش') + '</button>' + (editingFiche ? '<button type="button" class="button quiet" data-action="cancel-fiche">لغو ویرایش</button>' : '') + '</div></form><h3 style="margin-top:25px">فیش‌های پروژه</h3>' +
      (project.fiches.length ? project.fiches.map(f => '<div class="ficheCard"><span class="tag">' + esc(kinds[f.kind]) + '</span><p>' + esc(f.text) + '</p><small>' + esc((project.sources.find(s => s.id === f.sourceId) || {}).title || 'برداشت مؤلف') + ' · ' + esc(f.locator || 'نشانی ثبت نشده') + '</small><div class="toolbar"><button class="button quiet small" data-action="edit-fiche" data-id="' + esc(f.id) + '">ویرایش</button><button class="button danger small" data-action="delete-fiche" data-id="' + esc(f.id) + '">حذف</button></div></div>').join('') : '<div class="empty">اولین فیش را ثبت کنید.</div>') + '</section></div>';
  }
  function currentChapter() { return project.chapters.find(c => c.id === selectedChapter); }
  function blockView(b, i, total) {
    const content = b.type === 'list' ? b.items.join('\n') : b.text;
    return '<section class="blockCard" data-block-id="' + esc(b.id) + '"><div class="blockHead"><select aria-label="نوع بلوک ' + E.fa(i + 1) + '" data-block-field="type">' + options(typeLabels, b.type) + '</select><div class="blockTools"><button class="button quiet small" data-action="move-block" data-id="' + esc(b.id) + '" data-dir="-1" ' + (i === 0 ? 'disabled' : '') + ' aria-label="انتقال بلوک به بالا">↑</button><button class="button quiet small" data-action="move-block" data-id="' + esc(b.id) + '" data-dir="1" ' + (i === total - 1 ? 'disabled' : '') + ' aria-label="انتقال بلوک به پایین">↓</button><button class="button danger small" data-action="delete-block" data-id="' + esc(b.id) + '">حذف</button></div></div>' +
      '<label>محتوا ' + (b.type === 'list' ? '(هر مورد در یک خط)' : '') + '<textarea data-block-field="content" rows="4" maxlength="30000">' + esc(content) + '</textarea></label>' +
      '<div class="blockMeta"><div><label>منبع ارجاع<select data-block-field="sourceId">' + sourceOptions(b.sourceId, true) + '</select></label></div><div><label>نشانی ارجاع<input data-block-field="locator" maxlength="1000" value="' + esc(b.locator) + '"></label></div></div>' +
      (b.type === 'exercise' ? '<div class="blockMeta"><div><label>معیار بررسی<textarea data-block-field="rubric" rows="2" maxlength="5000">' + esc(b.rubric) + '</textarea></label></div><div><label>خطوط پاسخ در کتاب کار<input type="number" min="1" max="12" data-block-field="lines" value="' + b.lines + '"></label></div></div>' : '') + '</section>';
  }
  function chaptersView() {
    let c = currentChapter();
    if (!c && project.chapters.length) { selectedChapter = project.chapters[0].id; c = currentChapter(); }
    return '<div class="toolbar"><button class="button primary" data-action="add-chapter">+ فصل تازه</button><span class="hint">محتوا در هر قالب قابل استفاده است.</span></div><div class="chapterLayout"><aside class="chapterList" aria-label="فصل‌های کتاب">' +
      project.chapters.map((x, i) => '<button class="chapterPick ' + (x.id === selectedChapter ? 'active' : '') + '" data-chapter="' + esc(x.id) + '">' + E.fa(i + 1) + '. ' + esc(x.title) + '<small>' + E.fa(x.blocks.length) + ' بلوک محتوا</small></button>').join('') + '</aside>' +
      (c ? '<section class="panel chapterEditor"><div class="toolbar"><button class="button quiet" data-action="prompt">پرامپت و ورود پیش‌نویس</button><button class="button danger small" data-action="delete-chapter">حذف فصل</button></div>' +
      input('عنوان فصل', 'chapterTitle', c.title, 'data-bind="chapter:title" maxlength="500"') +
      '<label for="chapterObjectives">اهداف فصل، هر هدف در یک خط</label><textarea id="chapterObjectives" data-bind="chapter:objectives" rows="3" maxlength="10000">' + esc(c.objectives.join('\n')) + '</textarea>' +
      '<details style="margin-top:15px"><summary>فیش‌های مورد استفادهٔ این فصل (' + E.fa(c.fichIds.length) + ')</summary><div class="checkboxList">' + (project.fiches.length ? project.fiches.map(f => '<label class="checkLabel"><input type="checkbox" data-fiche-link="' + esc(f.id) + '" ' + (c.fichIds.includes(f.id) ? 'checked' : '') + '> ' + esc(f.text.slice(0, 120)) + '</label>').join('') : '<p class="hint">در بخش منابع، فیش بسازید.</p>') + '</div></details>' +
      '<h3 style="margin-top:25px">بلوک‌های فصل</h3><div id="blocks">' + c.blocks.map((b, i) => blockView(b, i, c.blocks.length)).join('') + '</div><div class="toolbar"><select id="newBlockType" aria-label="نوع بلوک تازه" style="max-width:165px">' + options(typeLabels, 'paragraph') + '</select><button class="button primary" data-action="add-block">+ افزودن بلوک</button></div></section>' : '<div class="empty">برای شروع، یک فصل بسازید.</div>') + '</div>';
  }
  function workflowView() {
    const l = window.BookWorkflow.find(l => l.id === step);
    return '<div class="stepGrid">' + window.BookWorkflow.map(l => '<button class="stepButton ' + (l.id === step ? 'active ' : '') + (project.workflow.completed.includes(l.id) ? 'done' : '') + '" data-step="' + l.id + '">' + E.fa(l.id) + '. ' + esc(l.title) + '</button>').join('') + '</div><section class="panel"><span class="eyebrow">فاز ' + E.fa(l.phase) + ' · ' + esc(l.tag) + '</span><h3>' + esc(l.title) + '</h3><p class="hint">دستاورد: ' + esc(l.outcome) + '</p>' + l.theory.map(p => '<p class="theory">' + esc(p) + '</p>').join('') +
      '<details><summary>نمونه و خطای رایج از فایل آموزشی</summary><div class="sampleBox">' + esc(l.good) + '</div><div class="sampleBox bad">' + esc(l.bad) + '</div><p class="hint">نمونه‌های فایل مبنا آموزشی‌اند؛ آن‌ها را با پروژه و منابع خودتان تطبیق دهید.</p></details>' +
      '<h4 style="margin-top:20px">تمرین این گام</h4><ol>' + l.exercise.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol><label for="workflowNote">تصمیم و یادداشت شما برای این کتاب</label><textarea id="workflowNote" class="workflowNote" maxlength="30000" data-workflow-note="' + step + '">' + esc(project.workflow.notes[step] || '') + '</textarea><label class="checkLabel"><input type="checkbox" data-workflow-complete="' + step + '" ' + (project.workflow.completed.includes(step) ? 'checked' : '') + '> انجام این گام را برای پروژهٔ خودم تأیید می‌کنم</label><p class="hint">این علامت خودارزیابی است. موتور، صحت علمی یا انجام واقعی کار را از روی تیک نتیجه نمی‌گیرد.</p><div class="toolbar"><button class="button quiet" data-step="' + Math.max(1, step - 1) + '" ' + (step === 1 ? 'disabled' : '') + '>→ گام قبل</button><button class="button primary" data-step="' + Math.min(18, step + 1) + '" ' + (step === 18 ? 'disabled' : '') + '>گام بعد ←</button></div></section>';
  }
  function previewView() {
    const valid = E.validateProject(project);
    if (!valid.ok) return '<section class="panel"><h3>پیش از خروجی، ورودی‌ها را کامل کنید</h3><ul>' + valid.errors.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></section>';
    const result = SDK.inspect(project);
    return '<div class="previewToolbar"><button class="button primary" data-action="download-html">دریافت کتاب HTML ↓</button><button class="button quiet" data-action="print">چاپ / ذخیره PDF</button><button class="button quiet" data-action="backup">پشتیبان کامل پروژه ↓</button></div>' +
      (result.warnings.length ? '<div class="warningList"><b>موارد نیازمند بازبینی</b><ul>' + result.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '<div class="readyNotice">ساختار پروژه معتبر است و در بررسی اولیه مورد ناقصی پیدا نشد. بازبینی محتوایی مؤلف همچنان لازم است.</div>') +
      '<iframe id="bookPreview" class="previewFrame" title="پیش‌نمایش مستقل کتاب" sandbox="allow-same-origin"></iframe>';
  }
  function aiView() {
    return '<div class="grid2"><section class="panel"><h3>یک موتور ثابت، کتاب‌های متفاوت</h3><p class="hint">مانند کلاس زنده که AI محتوای LESSON را می‌نویسد، این موتور دادهٔ BOOK را می‌گیرد. فایل بسته را همراه منابع به ابزار هوش مصنوعی بدهید و درخواست کتاب کنید.</p><div class="toolbar"><a class="button primary" href="ai-kit/01-ai-kit.html" download>دریافت بستهٔ تک‌فایلی AI ↓</a><a class="button quiet" href="ai-kit/book-template.html" download>قالب کتاب HTML ↓</a></div><div class="toolbar"><a class="button quiet" href="ai-kit/book-engine-ai.zip" download>بستهٔ کامل برای AI ابزارمحور ↓</a></div><ol class="hint"><li>موضوع و منابع خود را به AI بدهید.</li><li>پرامپت زیر و بسته یا قالب را پیوست کنید.</li><li>خروجی را با «ورود کتاب از AI» وارد و بازبینی کنید.</li></ol><button class="button primary" data-action="open-book-import">ورود کتاب از AI ↑</button><p class="hint">JSON، کتاب را برای ویرایش وارد کارگاه می‌کند. مسیر HTML، یک کتاب تک‌فایلی قابل اجرا می‌سازد. اتصال خودکار به سرویس مدل در این نسخه وجود ندارد.</p><details><summary>فایل‌های قرارداد و نمونه</summary><div class="toolbar"><a href="ai-kit/BOOK.schema.json" download>قرارداد BOOK</a><a href="ai-kit/BOOK-starter.json" download>نمونهٔ خالی</a><a href="examples/BOOK-three-chapters.json" download>نمونهٔ سه‌فصلی</a><a href="ai-kit/AUTHORING-GUIDE.fa.txt" download>راهنمای کامل</a></div></details></section>' +
      '<section class="panel"><h3>پرامپت تولید کل کتاب</h3><label for="aiBrief">موضوع، مخاطب و اندازهٔ کتاب</label><textarea id="aiBrief" rows="5">موضوع: ' + esc(project.metadata.title) + '\nمخاطب: ' + esc(project.metadata.audience) + '\nاندازهٔ اولیه: سه فصل\nمنابع: منابع و فیش‌های همین پروژه</textarea><label for="aiOutputMode">نوع خروجی</label><select id="aiOutputMode"><option value="json">دادهٔ کتاب برای ویرایش در کارگاه</option><option value="html">HTML تک‌فایلی با قالب پیوست</option></select><div class="toolbar"><button class="button primary" data-action="make-book-prompt">ساخت پرامپت</button></div><label for="fullBookPrompt">پرامپت آماده برای AI</label><textarea id="fullBookPrompt" rows="10" readonly></textarea><div class="toolbar"><button class="button quiet" data-action="copy-book-prompt">کپی پرامپت</button><button class="button quiet" data-action="download-book-prompt">دریافت پرامپت TXT ↓</button><button class="button quiet" data-action="download-book-spec">دریافت BOOK فعلی ↓</button></div></section></div>';
  }
  function makeBookPrompt() { requireValid(); $('fullBookPrompt').value = SDK.makePrompt(project, $('aiBrief').value, $('aiOutputMode').value); }
  function loadBookInput(raw) { return /^\s*</.test(raw.replace(/^\uFEFF/, '')) ? SDK.extractHtml(raw) : SDK.parseInput(raw); }
  function render() {
    for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
    $('viewTitle').textContent = viewInfo[view][0]; $('viewDescription').textContent = viewInfo[view][1];
    const makers = { metadata: metadataView, sources: sourcesView, chapters: chaptersView, workflow: workflowView, preview: previewView, ai: aiView };
    $('view').innerHTML = makers[view](); updateStats();
    if ($('bookPreview')) $('bookPreview').srcdoc = E.renderBook(project);
    if (view === 'ai' && E.validateProject(project).ok) makeBookPrompt();
  }
  function switchView(next) { view = next; render(); }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function replace(next) { project = next; selectedChapter = project.chapters[0] && project.chapters[0].id; editingFiche = null; commit(true); }
  function requireValid() {
    const result = E.validateProject(project);
    if (!result.ok) throw new Error(result.errors.join('\n'));
  }
  function printBook() {
    requireValid();
    const win = window.open('', '_blank');
    if (!win) throw new Error('پنجرهٔ چاپ باز نشد. اجازهٔ باز شدن پنجره را بدهید یا فایل HTML کتاب را دریافت کنید.');
    win.document.open(); win.document.write(E.renderBook(project)); win.document.close();
    let printed = false;
    const invoke = () => { if (!printed) { printed = true; win.focus(); win.print(); } };
    win.onload = invoke;
    if (win.document.readyState === 'complete') setTimeout(invoke, 300);
  }
  function validatedMutation(change) {
    const next = E.clone(project); change(next);
    const result = E.validateProject(next); if (!result.ok) throw new Error(result.errors.join('\n'));
    project = next; commit(true);
  }
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches('[data-source-form],#ficheForm')) return;
    event.preventDefault();
    try {
      if (form.matches('[data-source-form]')) {
        const s = { id: form.dataset.sourceForm || E.id('source') };
        for (const key of ['title', 'creator', 'year', 'locator', 'url', 'excerpt']) s[key] = form.querySelector('[data-field="' + key + '"]').value.trim();
        s.verified = form.querySelector('[data-field="verified"]').checked;
        validatedMutation(next => { const index = next.sources.findIndex(x => x.id === s.id); if (index < 0) next.sources.push(s); else next.sources[index] = s; });
        notice('منبع ثبت شد.');
      } else {
        const f = { id: editingFiche || E.id('fiche'), kind: form.elements.kind.value, sourceId: form.elements.sourceId.value || null, text: form.elements.text.value.trim(), locator: $('ficheLocator').value.trim(), keywords: $('ficheKeywords').value.trim() };
        validatedMutation(next => { const index = next.fiches.findIndex(x => x.id === f.id); if (index < 0) next.fiches.push(f); else next.fiches[index] = f; });
        editingFiche = null; render(); notice('فیش ثبت شد؛ اکنون می‌توانید آن را به فصل وصل کنید.');
      }
    } catch (err) { notice(err.message, true); }
  });
  function boundInput(target) {
    if (target.dataset.bind) {
      const pair = target.dataset.bind.split(':'), parent = pair[0] === 'metadata' ? project.metadata : currentChapter();
      parent[pair[1]] = pair[1] === 'objectives' ? target.value.split('\n').map(x => x.trim()).filter(Boolean) : target.value;
      commit(false); return true;
    }
    if (target.dataset.blockField) {
      const b = currentChapter().blocks.find(b => b.id === target.closest('[data-block-id]').dataset.blockId), key = target.dataset.blockField;
      if (key === 'content') { if (b.type === 'list') b.items = target.value.split('\n').map(x => x.trim()).filter(Boolean); else b.text = target.value; }
      else if (key === 'sourceId') b.sourceId = target.value || null;
      else if (key === 'lines') b.lines = Number(target.value);
      else if (key === 'type') { b.type = target.value; if (b.type === 'list' && !b.items.length) b.items = [b.text || 'مورد تازه']; if (b.type !== 'list' && !b.text.trim()) b.text = b.items.join('\n') || 'متن تازه'; }
      else b[key] = target.value;
      commit(key === 'type'); return true;
    }
    if (target.dataset.workflowNote) { project.workflow.notes[target.dataset.workflowNote] = target.value; commit(false); return true; }
    return false;
  }
  document.addEventListener('input', event => { if (!event.target.matches('select,input[type=checkbox]')) boundInput(event.target); });
  document.addEventListener('change', event => {
    const t = event.target;
    if (t.matches('select')) boundInput(t);
    if (t.dataset.ficheLink) {
      const c = currentChapter(); c.fichIds = t.checked ? Array.from(new Set(c.fichIds.concat(t.dataset.ficheLink))) : c.fichIds.filter(id => id !== t.dataset.ficheLink); commit(false);
    }
    if (t.dataset.workflowComplete) {
      const n = Number(t.dataset.workflowComplete); project.workflow.completed = t.checked ? Array.from(new Set(project.workflow.completed.concat(n))) : project.workflow.completed.filter(x => x !== n); commit(false);
    }
  });
  document.addEventListener('click', async event => {
    const b = event.target.closest('button');
    if (!b || b.disabled) return;
    try {
      if (b.dataset.view || b.dataset.go) { switchView(b.dataset.view || b.dataset.go); return; }
      if (b.dataset.chapter) { selectedChapter = b.dataset.chapter; render(); return; }
      if (b.dataset.step) { step = Number(b.dataset.step); render(); return; }
      const action = b.dataset.action, c = currentChapter();
      if (action === 'backup') { download('book-project.json', E.serializeProject(project)); notice('پشتیبان همهٔ فصل‌ها، منابع، فیش‌ها و یادداشت‌های مسیر آماده شد.'); }
      if (action === 'export') switchView('preview');
      if (action === 'import') $('projectFile').click();
      if (action === 'open-book-import') { $('bookInput').value = ''; $('bookImportError').textContent = ''; $('bookImportDialog').showModal(); }
      if (action === 'close-book-dialog') $('bookImportDialog').close();
      if (action === 'make-book-prompt') makeBookPrompt();
      if (action === 'download-book-spec') download('BOOK.json', JSON.stringify(SDK.toBookSpec(project), null, 2));
      if (action === 'download-book-prompt') download('book-prompt.txt', $('fullBookPrompt').value, 'text/plain;charset=utf-8');
      if (action === 'copy-book-prompt') {
        try { await navigator.clipboard.writeText($('fullBookPrompt').value); notice('پرامپت کل کتاب کپی شد.'); }
        catch (_) { $('fullBookPrompt').focus(); $('fullBookPrompt').select(); notice('پرامپت انتخاب شد؛ با Ctrl+C کپی کنید.'); }
      }
      if (action === 'apply-book') {
        try {
          const next = loadBookInput($('bookInput').value), check = SDK.inspect(next);
          if (!confirm('کتاب «' + next.metadata.title + '» با ' + next.chapters.length + ' فصل معتبر است و ' + check.warnings.length + ' مورد بازبینی دارد. جایگزین پروژه جاری شود؟ ابتدا در صورت نیاز پشتیبان بگیرید.')) return;
          $('bookImportDialog').close(); view = 'metadata'; replace(next); notice('کتاب وارد شد. متن و ارجاع‌ها را بازبینی کنید.');
        } catch (err) { $('bookImportError').textContent = err.message; }
      }
      if (action === 'new' && confirm('پروژهٔ جاری جایگزین می‌شود. اگر لازم است ابتدا پشتیبان بگیرید. کتاب تازه ساخته شود؟')) { view = 'metadata'; replace(E.emptyProject()); }
      if (action === 'sample' && confirm('پروژهٔ جاری با نمونهٔ سه‌فصلی جایگزین شود؟ ابتدا از نوشته‌های خود پشتیبان بگیرید.')) { view = 'metadata'; replace(E.clone(window.BookSample)); }
      if (action === 'download-html') { download('book.html', E.renderBook(project), 'text/html;charset=utf-8'); notice('فایل مستقل کتاب آماده شد.'); }
      if (action === 'print') printBook();
      if (action === 'add-chapter') { const chapter = { id: E.id('chapter'), title: 'فصل تازه', objectives: [], fichIds: [], blocks: [E.createBlock('paragraph')] }; project.chapters.push(chapter); selectedChapter = chapter.id; commit(true); }
      if (action === 'delete-chapter' && c && confirm('فصل «' + c.title + '» و محتوای آن حذف شود؟')) { project.chapters = project.chapters.filter(x => x.id !== c.id); selectedChapter = project.chapters[0] && project.chapters[0].id; commit(true); }
      if (action === 'add-block') {
        const type = $('newBlockType').value;
        if (type === 'quote' && !project.sources.length) throw new Error('پیش از افزودن نقل‌قول، یک منبع ثبت کنید.');
        c.blocks.push(E.createBlock(type, { sourceId: type === 'quote' ? project.sources[0].id : null, items: type === 'list' ? ['مورد تازه'] : [] })); commit(true);
      }
      if (action === 'delete-block' && confirm('این بلوک از فصل حذف شود؟')) { c.blocks = c.blocks.filter(x => x.id !== b.dataset.id); commit(true); }
      if (action === 'move-block') { const index = c.blocks.findIndex(x => x.id === b.dataset.id), other = index + Number(b.dataset.dir); if (other >= 0 && other < c.blocks.length) { [c.blocks[index], c.blocks[other]] = [c.blocks[other], c.blocks[index]]; commit(true); } }
      if (action === 'edit-fiche') { editingFiche = b.dataset.id; render(); }
      if (action === 'cancel-fiche') { editingFiche = null; render(); }
      if (action === 'delete-fiche' && confirm('فیش حذف و ارتباط آن با فصل‌ها برداشته شود؟')) { project.fiches = project.fiches.filter(f => f.id !== b.dataset.id); for (const chapter of project.chapters) chapter.fichIds = chapter.fichIds.filter(id => id !== b.dataset.id); commit(true); }
      if (action === 'delete-source') {
        if (project.fiches.some(f => f.sourceId === b.dataset.id) || project.chapters.some(c => c.blocks.some(x => x.sourceId === b.dataset.id))) throw new Error('این منبع در فیش یا فصل استفاده شده است. ابتدا ارجاع‌های آن را تغییر دهید.');
        if (confirm('این منبع حذف شود؟')) { project.sources = project.sources.filter(s => s.id !== b.dataset.id); commit(true); }
      }
      if (action === 'prompt') { requireValid(); $('chapterPrompt').value = E.buildChapterPrompt(project, c.id); $('draftInput').value = ''; $('draftError').textContent = ''; $('promptDialog').showModal(); }
      if (action === 'close-dialog') $('promptDialog').close();
      if (action === 'copy-prompt') {
        try { await navigator.clipboard.writeText($('chapterPrompt').value); notice('پرامپت کپی شد.'); }
        catch (_) { $('chapterPrompt').focus(); $('chapterPrompt').select(); notice('پرامپت انتخاب شد؛ با Ctrl+C کپی کنید.'); }
      }
      if (action === 'apply-draft') {
        try {
          const next = E.parseChapterDraft($('draftInput').value, project, c.id);
          if (!confirm('پیش‌نویس معتبر است و ' + next.chapters.find(x => x.id === c.id).blocks.length + ' بلوک دارد. محتوای فعلی همین فصل جایگزین شود؟ ابتدا در صورت نیاز پشتیبان بگیرید.')) return;
          project = next; commit(true); $('promptDialog').close(); notice('پیش‌نویس وارد شد. محتوا و ارجاع‌ها را بازبینی کنید.');
        } catch (err) { $('draftError').textContent = err.message; }
      }
    } catch (err) { notice(err.message, true); }
  });
  $('projectFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const maxSize = /\.html?$/i.test(file.name) ? 5000000 : 2000000;
      if (file.size > maxSize) throw new Error('اندازه فایل بیش از حد مجاز است؛ JSON تا ۲ و HTML تا ۵ مگابایت.');
      const next = loadBookInput(await file.text());
      if (!confirm('پروژه «' + next.metadata.title + '» با ' + next.chapters.length + ' فصل و ' + next.fiches.length + ' فیش معتبر است. جایگزین پروژه جاری شود؟')) return;
      if ($('bookImportDialog').open) $('bookImportDialog').close();
      view = 'metadata';
      replace(next); notice('پروژه بازیابی شد.');
    } catch (err) { notice('بازیابی انجام نشد؛ پروژهٔ فعلی حفظ شد.\n' + err.message, true); }
    finally { event.target.value = ''; }
  });
  window.addEventListener('beforeunload', event => { if (!persisted) { event.preventDefault(); event.returnValue = ''; } });
  render();
  if (storageIssue) { saveStatus('ذخیره در دسترس نیست', true); notice(storageIssue, true); }
  else saveStatus('آماده · ذخیره در همین مرورگر', false);
})();
