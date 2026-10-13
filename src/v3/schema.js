'use strict';
// Minimal JSON Schema (draft 2020-12 subset) validator. The schema files in ./schemas are the
// single source of truth for the shape of project files; this module only interprets them.
// Supported keywords: type, const, enum, pattern, minLength, maxLength, minimum, maximum,
// minItems, maxItems, items, properties, required, additionalProperties:false, anyOf, $ref (#/$defs/..).
const fs = require('node:fs');
const path = require('node:path');

const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
const matches = (t, v) => t === typeOf(v) || (t === 'number' && typeof v === 'number' && Number.isFinite(v));

function validate(schema, value, root, at) {
  root = root || schema;
  at = at || '';
  const errors = [];
  const add = (keyword, message) => errors.push({ path: at || '/', keyword, message });
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, '');
    if (!root.$defs || !root.$defs[name]) throw new Error('Unknown $ref ' + schema.$ref);
    return validate(root.$defs[name], value, root, at);
  }
  if (schema.anyOf) {
    const ok = schema.anyOf.some(s => validate(s, value, root, at).length === 0);
    if (!ok) add('anyOf', 'مقدار با هیچ‌یک از حالت‌های مجاز سازگار نیست.');
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matches(t, value))) { add('type', 'نوع مقدار باید ' + types.join(' یا ') + ' باشد.'); return errors; }
  }
  if ('const' in schema && value !== schema.const) add('const', 'مقدار باید ' + JSON.stringify(schema.const) + ' باشد.');
  if (schema.enum && !schema.enum.includes(value)) add('enum', 'مقدار باید یکی از این‌ها باشد: ' + schema.enum.join('، '));
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) add('minLength', 'متن خالی یا بیش از حد کوتاه است.');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add('maxLength', 'متن بیش از ' + schema.maxLength + ' نویسه است.');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) add('pattern', schema.patternMessage || 'قالب متن معتبر نیست.');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) add('minimum', 'مقدار کمتر از ' + schema.minimum + ' است.');
    if (schema.maximum !== undefined && value > schema.maximum) add('maximum', 'مقدار بیشتر از ' + schema.maximum + ' است.');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add('minItems', 'دست‌کم ' + schema.minItems + ' مورد لازم است.');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add('maxItems', 'حداکثر ' + schema.maxItems + ' مورد مجاز است.');
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, at + '/' + i)));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    for (const k of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, k)) add('required', 'فیلد لازم «' + k + '» وجود ندارد.');
    for (const k of Object.keys(value)) {
      if (props[k]) errors.push(...validate(props[k], value[k], root, at + '/' + k));
      else if (schema.additionalProperties === false) errors.push({ path: at + '/' + k, keyword: 'additionalProperties', message: 'فیلد ناشناخته «' + k + '».' });
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, value[k], root, at + '/' + k));
    }
  }
  return errors;
}

const dir = path.join(__dirname, 'schemas');
const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(dir, name + '.schema.json'), 'utf8')));
  return cache.get(name);
}
function check(name, value) { const s = load(name); return validate(s, value, s); }
function applyDefaults(schema, value) {
  if (typeOf(value) !== 'object' || !schema.properties) return value;
  for (const [k, s] of Object.entries(schema.properties)) if (value[k] === undefined && 'default' in s) value[k] = JSON.parse(JSON.stringify(s.default));
  return value;
}

module.exports = { validate, check, load, applyDefaults, SCHEMA_DIR: dir };
