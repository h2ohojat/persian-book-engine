'use strict';
// Block registry. Each instructional block type is one entry: its attribute schema, allowed
// content, extra checks, renderers and the text that teaches an AI author how to write it.
// Renderers receive only escaped-HTML helpers from ctx; they never see raw markup.

const sourceAttrs = {
  source: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' },
  locator: { type: 'string', maxLength: 1000 }
};

const registry = new Map();

function register(def) {
  if (!def || !/^[a-z][a-z0-9-]*$/.test(def.type)) throw new Error('Block type name is invalid.');
  if (registry.has(def.type)) throw new Error('Block type already registered: ' + def.type);
  registry.set(def.type, Object.freeze(def));
}

register({
  type: 'callout',
  since: 1,
  attributes: Object.assign({ kind: { enum: ['note', 'example', 'warning', 'gap'] } }, sourceAttrs),
  slots: {},
  children: 'blocks',
  check() {},
  render: {
    html(node, ctx) { return '<aside class="callout' + (node.attrs.kind ? ' callout-' + ctx.esc(node.attrs.kind) : '') + '"' + ctx.anchor(node) + '>' + ctx.blocks(node.children) + ctx.citation(node) + '</aside>'; }
  },
  ai: { describe: 'نکته، محدودیت، کمبود شاهد یا مثال فرضی. kind اختیاری: note | example | warning | gap.', example: ':::callout {#ch1-note kind=example}\nمثال فرضی: ...\n:::' }
});

register({
  type: 'quote',
  since: 1,
  attributes: sourceAttrs,
  required: ['source', 'locator'],
  slots: {},
  children: 'blocks',
  check(node, ctx) {
    if (!node.attrs.source || !String(node.attrs.locator || '').trim()) ctx.report('error', 'quote.locator', 'نقل‌قول باید source و locator دقیق داشته باشد.', node, 'مثال: {#q1 source=src-id locator="ص ۴۵"}');
  },
  render: {
    html(node, ctx) { return '<blockquote class="quote"' + ctx.anchor(node) + '>' + ctx.blocks(node.children) + ctx.citation(node) + '</blockquote>'; }
  },
  ai: { describe: 'نقل‌قول مستقیم؛ متن باید عیناً در گزیدهٔ منبع باشد. source و locator لازم است.', example: ':::quote {#ch1-q1 source=src-id locator="ص ۱۲، بند ۲"}\nمتن دقیق منبع.\n:::' }
});

register({
  type: 'exercise',
  since: 1,
  attributes: Object.assign({ lines: { type: 'integer', minimum: 1, maximum: 12 }, rubric: { type: 'string', maxLength: 5000 } }, sourceAttrs),
  slots: { rubric: { optional: true } },
  children: 'blocks',
  check() {},
  render: {
    html(node, ctx) {
      const label = ctx.format === 'trainer' ? 'فعالیت پیشنهادی برای اجرا' : 'تمرین و کاربرد';
      const rubric = node.slots.rubric ? ctx.inline(node.slots.rubric.children) : node.attrs.rubric ? ctx.text(node.attrs.rubric) : '';
      const lines = node.attrs.lines || 4;
      const answer = ctx.format === 'workbook' ? '<div aria-label="فضای پاسخ">' + '<div class="response"></div>'.repeat(lines) + '</div>' : '';
      return '<section class="exercise"' + ctx.anchor(node) + '><h4>' + label + '</h4>' + ctx.blocks(node.children) + (rubric ? '<div class="rubric">معیار بررسی: ' + rubric + '</div>' : '') + answer + ctx.citation(node) + '</section>';
    }
  },
  ai: { describe: 'تمرین با خطوط پاسخ lines (۱ تا ۱۲) و معیار بررسی اختیاری در ::rubric[...].', example: ':::exercise {#ch1-ex1 lines=6}\nصورت تمرین.\n\n::rubric[معیار بررسی.]\n:::' }
});

function get(type) { return registry.get(type); }
function types() { return Array.from(registry.keys()); }
function attributeSchema(type) {
  const def = registry.get(type);
  return { type: 'object', additionalProperties: false, properties: def.attributes, required: def.required || [] };
}
function aiGuide() {
  return types().map(t => { const d = registry.get(t); return ':::' + t + ' — ' + d.ai.describe + '\n' + d.ai.example; }).join('\n\n');
}

module.exports = { register, get, types, attributeSchema, aiGuide };
