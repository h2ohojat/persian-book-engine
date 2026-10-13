# راهنمای تألیف با BookEngine نسخهٔ ۰.۳

این راهنما برای مؤلف و برای عامل هوش مصنوعی است که کتاب را در **پوشهٔ پروژه** (قرارداد ۳) می‌نویسد. طراحی کامل در [DESIGN-v0.3.fa.md](DESIGN-v0.3.fa.md) آمده است.

## شروع

```bash
node bookengine.js new books/my-book --title "عنوان کتاب" --format workbook
```

یا تبدیل یک کتاب نسخهٔ ۰.۲:

```bash
node bookengine.js import books/old/BOOK.json books/my-book
```

`import` فایل BOOK.json، پشتیبان پروژهٔ JSON و HTML خروجی ۰.۲ را می‌پذیرد.

## چرخهٔ کار هر فصل

1. `node bookengine.js add-chapter books/my-book --id basics --title "مفاهیم پایه" [--after intro]`
2. `node bookengine.js context books/my-book --chapter basics --out context.txt` — بستهٔ محدودی برای نوشتن همین فصل: دستور کار، بلوک‌های مجاز، شناسنامه، سبک، فیش‌ها و گزیدهٔ منابع، واژه‌نامه، طرح کتاب و خلاصهٔ فصل‌های نزدیک. اندازه‌اش به بودجه (`--budget`) بستگی دارد، نه به تعداد فصل‌ها.
3. فصل را در `chapters/NN-basics.md` بنویسید.
4. `node bookengine.js validate books/my-book --chapter basics` — هر خطا کد، فایل، شمارهٔ خط و در صورت امکان پیشنهاد اصلاح دارد. با `--json` خروجی ماشین‌خوان است.
5. `node bookengine.js ids books/my-book --write` — اگر بلوکی شناسه ندارد.
6. خلاصهٔ کوتاه فصل را در `memory/summaries/basics.md` بنویسید تا فصل‌های بعدی به آن دسترسی داشته باشند.
7. `node bookengine.js build books/my-book` — خروجی در `dist/book.html`. فقط فصل‌های تغییرکرده دوباره رندر می‌شوند.

`node bookengine.js outline books/my-book` وضعیت، تعداد واژه و تعداد خطا/هشدار هر فصل را نشان می‌دهد.

## فرمت فایل فصل

```markdown
---
id: basics
title: مفاهیم پایه
objectives:
  - تفاوت فیش نقل‌قول و خلاصه را تشخیص می‌دهد.
fiches: [fiche-007]
---

## فیش چیست؟ {#basics-what}

متن با *تأکید* و **تأکید قوی**، ارجاع [@src-eco; ص ۴۵]، پانویس^[متن پانویس]،
اصطلاح {term:fiche} و ارجاع متقابل [بخش بعد](#ref:basics-sorting).

{#basics-p2 source=src-eco locator="ص ۴۶"}
پاراگرافی که کل آن از یک منبع آمده است.

| ستون | ستون |
| --- | --- |
| خانه | خانه |

:::callout {#basics-note kind=example}
مثال فرضی: …
:::

:::quote {#basics-q1 source=src-eco locator="ص ۴۵، بند ۲"}
متن دقیقاً مطابق گزیدهٔ منبع.
:::

:::exercise {#basics-ex1 lines=6}
صورت تمرین.

::rubric[معیار بررسی.]
:::
```

قواعد اصلی:

- تیترها `##` تا `####` و زیربخش تودرتو می‌سازند. عنوان فصل فقط در frontmatter است.
- تیترها و بلوک‌های `:::` باید شناسهٔ صریح `{#id}` داشته باشند. شناسه در کل کتاب یکتاست.
- ویژگی بلوک‌های ساده در یک سطر `{#id source=… locator="…"}` درست پیش از بلوک می‌آید.
- نویسه‌های `\ * [ ] ^ { } \` |` را اگر معنای قالب‌بندی ندارند با `\` بنویسید. سطری که با `#`، `-`، `:::` یا `|` شروع می‌شود و تیتر، فهرست یا بلوک نیست هم با `\` شروع شود.
- HTML خام اجرا نمی‌شود و به صورت متن چاپ می‌شود. لینک فقط `http`/`https` یا `#ref:شناسه`.
- نقل‌قول باید عیناً در `sources/excerpts/<sourceId>.txt` باشد؛ در غیر این صورت هشدار `quote.mismatch` می‌گیرد.

## فایل‌های دیگر پروژه

| فایل | محتوا |
| --- | --- |
| `book.yaml` | شناسنامه: `bookEngine: 3`، `id`، `title`، `authors`، `audience`، `format`، `targets.wordsPerChapter` |
| `style.yaml` | `tone`، `readingLevel`، `rules` |
| `outline.yaml` | `chapters` یا `parts[].chapters`؛ هر فصل `id`، `file`، `status` (`planned`، `drafted`، `in-review`، `approved`) |
| `sources/sources.json` | آرایهٔ منابع؛ `verified` فقط توسط مؤلف |
| `sources/excerpts/<id>.txt` | گزیدهٔ متن منبع برای تطبیق نقل‌قول |
| `fiches/fiches.jsonl` | هر سطر یک فیش JSON |
| `memory/glossary.yaml` | `terms[]` با `id`، `term`، `definition`، `avoid` |
| `memory/summaries/<chapterId>.md` | خلاصهٔ هر فصل برای context |
| `memory/decisions.md` | تصمیم‌های تألیفی |

schemaهای دقیق در `src/v3/schemas/` هستند و اعتبارسنجی مستقیماً از آن‌ها انجام می‌شود.

## مرز مسئولیت هوش مصنوعی

- منبع، آمار، نقل‌قول و شماره صفحه نسازید. کمبود شاهد را با `:::callout {kind=gap}` نشان دهید.
- `verified`، `verifiedBy`، `approvedBy` و `status: approved` را فقط مؤلف ثبت می‌کند.
- validate و build صحت ساختار را بررسی می‌کنند، نه صحت علمی متن را.
