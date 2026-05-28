'use strict';

// E-2 sanitizer spec tests.
// These bind to the ACTUAL source in index.js: we read the file, extract the
// sanitizeString + sanitizeAnnouncementText function bodies, and eval them in
// isolation (with MAX_STRING_LENGTH injected). If index.js changes the
// functions, re-run this file — it tests the live code, not a copy.
//
// Run: node firebase/functions/_test_sanitize.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

function extractFn(name) {
  // Match `function name(...) { ... }` with brace counting from the first {.
  const start = src.indexOf('function ' + name + '(');
  assert(start !== -1, 'could not find function ' + name + ' in index.js');
  let i = src.indexOf('{', start);
  assert(i !== -1, 'no opening brace for ' + name);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Eval the two functions in a sandbox that provides MAX_STRING_LENGTH.
const MAX_STRING_LENGTH = 500;
// eslint-disable-next-line no-eval
const factory = new Function('MAX_STRING_LENGTH',
  extractFn('sanitizeString') + '\n' +
  extractFn('sanitizeAnnouncementText') + '\n' +
  'return { sanitizeString, sanitizeAnnouncementText };');
const { sanitizeString, sanitizeAnnouncementText } = factory(MAX_STRING_LENGTH);

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function group(name, fn) { console.log('# ' + name); fn(); }

group('sanitizeString — fixpoint tag strip (E-2)', () => {
  t('simple tag removed', () => {
    assert.strictEqual(sanitizeString('<b>hi</b>'), 'hi');
  });
  t('script tag removed', () => {
    assert.strictEqual(sanitizeString('<script>alert(1)</script>x'), 'alert(1)x');
  });
  t('reconstruction bypass defeated: <scr<script>ipt>', () => {
    // A single-pass strip would leave a live <script>. Fixpoint must remove all.
    const out = sanitizeString('<scr<script>ipt>alert(1)<</script>/script>');
    assert(!/<script/i.test(out), 'still contains <script: ' + out);
    assert(!/<\/script/i.test(out), 'still contains </script: ' + out);
  });
  t('img onerror tag removed', () => {
    const out = sanitizeString('<img src=x onerror=alert(1)>');
    assert(!/onerror/i.test(out) || !/</.test(out), 'tag survived: ' + out);
    assert.strictEqual(out.indexOf('<'), -1);
  });
  t('legitimate ampersand preserved (plain-text model)', () => {
    assert.strictEqual(sanitizeString("Ben & Jerry's"), "Ben & Jerry's");
  });
  t('non-string passes through', () => {
    assert.strictEqual(sanitizeString(42), 42);
  });
  t('truncates to MAX_STRING_LENGTH', () => {
    assert.strictEqual(sanitizeString('a'.repeat(1000)).length, 500);
  });
});

group('sanitizeAnnouncementText — strict (E-2)', () => {
  t('tags removed', () => {
    assert.strictEqual(sanitizeAnnouncementText('<b>hi</b>').trim(), 'hi');
  });
  t('numeric entity &#60;script&#62; neutralized (no bracket survives)', () => {
    const out = sanitizeAnnouncementText('&#60;script&#62;alert(1)&#60;/script&#62;');
    assert.strictEqual(out.indexOf('<'), -1, 'has <: ' + out);
    assert.strictEqual(out.indexOf('>'), -1, 'has >: ' + out);
    assert(!/script/i.test(out) === false || true); // text may remain, brackets must not
  });
  t('hex entity &#x3c; neutralized', () => {
    const out = sanitizeAnnouncementText('&#x3c;img src=x&#x3e;');
    assert.strictEqual(out.indexOf('<'), -1);
    assert.strictEqual(out.indexOf('>'), -1);
  });
  t('named entity &lt;&gt; neutralized', () => {
    const out = sanitizeAnnouncementText('&lt;svg onload=alert(1)&gt;');
    assert.strictEqual(out.indexOf('<'), -1);
    assert.strictEqual(out.indexOf('>'), -1);
  });
  t('residual lone angle brackets removed', () => {
    const out = sanitizeAnnouncementText('5 < 10 > 3');
    assert.strictEqual(out.indexOf('<'), -1);
    assert.strictEqual(out.indexOf('>'), -1);
  });
  t('AT&T / R&D entity-less ampersands left intact', () => {
    const out = sanitizeAnnouncementText('AT&T and R&D update');
    assert(out.indexOf('AT&T') !== -1, 'AT&T corrupted: ' + out);
    assert(out.indexOf('R&D') !== -1, 'R&D corrupted: ' + out);
  });
});

console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
