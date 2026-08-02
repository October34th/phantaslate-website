/* =====================================================================
   Phantaslate — phantaslate.com
   assets/js/demo.js

   Behaviour for the try-it panel on the homepage.

   ---------------------------------------------------------------------
   DEMO_MODE — read this before changing it
   ---------------------------------------------------------------------
   true   No network request is made. A small phrasebook returns canned
          results so the page is fully browsable as a static file, and
          anything outside the phrasebook returns a clearly marked
          placeholder. This is a stub. It does not translate.

   false  Posts to RELAY_URL and expects the response shape the extension
          already uses:
            { translation, detected_language, detected_code, source_mismatch }

   Do not flip this to false until the web endpoint exists as its own
   thing. The relay's current origin check, character cap and abuse
   handling were designed around the extension, which sends a known
   extension origin. A public web page is a different and much softer
   target, and needs:
     - phantaslate.com added to the relay's allowed origins
     - its own character cap, separate from the extension's daily cap
     - its own rate limiting, since there is no install token here
   ===================================================================== */

const DEMO_MODE = true;
const RELAY_URL = 'https://api.phantaslate.com/translate';
const MAX_CHARS = 500;

/* The nine supported languages, CJKV first — the order reflects what the
   product is built for, not alphabetical convenience. Codes match the
   relay's own language codes exactly. */
const LANGUAGES = [
  { code: 'en',      name: 'English' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)' },
  { code: 'ja',      name: 'Japanese' },
  { code: 'ko',      name: 'Korean' },
  { code: 'vi',      name: 'Vietnamese' },
  { code: 'es',      name: 'Spanish' },
  { code: 'fr',      name: 'French' },
  { code: 'de',      name: 'German' }
];

/* Stub responses only. Keyed by lowercased, trimmed source text. */
const PHRASEBOOK = {
  'かわいい':      { translation: 'Cute',        detected: 'Japanese',              code: 'ja' },
  'ありがとう':    { translation: 'Thank you',   detected: 'Japanese',              code: 'ja' },
  '감사합니다':     { translation: 'Thank you',   detected: 'Korean',                code: 'ko' },
  '你好':          { translation: 'Hello',       detected: 'Chinese (Simplified)',  code: 'zh-Hans' },
  '謝謝':          { translation: 'Thank you',   detected: 'Chinese (Traditional)', code: 'zh-Hant' },
  'cảm ơn bạn':   { translation: 'Thank you',   detected: 'Vietnamese',            code: 'vi' },
  'gracias':      { translation: 'Thank you',   detected: 'Spanish',               code: 'es' },
  'merci':        { translation: 'Thank you',   detected: 'French',                code: 'fr' },
  'danke':        { translation: 'Thank you',   detected: 'German',                code: 'de' }
};

const STUB_REPLY =
  'Demo mode — this page is not connected to the relay yet. ' +
  'Install the extension to translate for real.';

/* ------------------------------------------------------------------ setup */
const el = (id) => document.getElementById(id);

const source    = el('source');
const output    = el('output');
const panes     = el('panes');
const status    = el('status');
const statusMsg = el('status-text');
const counter   = el('count');
const detected  = el('detected');
const btn       = el('translate');
const clearBtn  = el('clear');
const copyBtn   = el('copy');
const fromSel   = el('from');
const toSel     = el('to');

function buildLanguageOptions() {
  const auto = new Option('Auto-detect', 'auto', true, true);
  fromSel.add(auto);

  LANGUAGES.forEach((lang) => {
    fromSel.add(new Option(lang.name, lang.code));
    toSel.add(new Option(lang.name, lang.code));
  });

  toSel.value = 'en';
}

function setStatus(message, state) {
  statusMsg.textContent = message;
  status.dataset.state = state || 'idle';
}

function updateCounter() {
  counter.textContent = source.value.length + ' / ' + MAX_CHARS;
  clearBtn.hidden = source.value.length === 0;
}

function resetOutput() {
  output.textContent = '';
  detected.textContent = '';
  copyBtn.hidden = true;
}

/* Han unification means Chinese and Japanese share codepoints but render
   them differently — a browser cannot tell 直 in Japanese from 直 in
   Chinese without being told. Declaring the language on each pane lets
   the :lang() rules in fonts.css pick the right face. */
function applyPaneLanguages(detectedCode) {
  const from = fromSel.value;
  source.lang = (from === 'auto') ? (detectedCode || '') : from;
  output.lang = toSel.value;
}

/* ------------------------------------------------------------------ events */
source.addEventListener('input', updateCounter);

source.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    translate();
  }
});

clearBtn.addEventListener('click', () => {
  source.classList.add('dissolving');
  window.setTimeout(() => {
    source.value = '';
    source.classList.remove('dissolving');
    resetOutput();
    updateCounter();
    setStatus('Cleared \u00b7 nothing stored', 'idle');
    source.focus();
  }, 430);
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    copyBtn.textContent = 'Copied';
    window.setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
  } catch (err) {
    setStatus('Your browser blocked the copy. Select the text instead.', 'error');
  }
});

el('swap').addEventListener('click', () => {
  if (fromSel.value === 'auto') {
    fromSel.value = toSel.value;
  } else {
    const held = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = held;
  }

  if (output.textContent) {
    source.value = output.textContent.slice(0, MAX_CHARS);
    resetOutput();
    updateCounter();
  }
});

fromSel.addEventListener('change', () => applyPaneLanguages());
toSel.addEventListener('change', () => applyPaneLanguages());

btn.addEventListener('click', translate);

/* ------------------------------------------------------------------ translate */
async function translate() {
  const text = source.value.trim();

  if (!text) {
    source.focus();
    setStatus('Enter some text first', 'idle');
    return;
  }

  btn.disabled = true;
  panes.classList.add('is-working');
  setStatus('Passing through\u2026', 'idle');
  resetOutput();

  try {
    const result = DEMO_MODE
      ? await stubTranslate(text)
      : await relayTranslate(text);

    output.textContent = result.translation;

    if (result.detected_language && fromSel.value === 'auto') {
      detected.textContent = 'Detected: ' + result.detected_language;
    }

    applyPaneLanguages(result.detected_code);
    copyBtn.hidden = false;
    setStatus('Translated \u00b7 nothing stored', 'idle');
  } catch (err) {
    setStatus('That request didn\u2019t go through. Try again.', 'error');
  } finally {
    panes.classList.remove('is-working');
    btn.disabled = false;
  }
}

function stubTranslate(text) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const hit = PHRASEBOOK[text] || PHRASEBOOK[text.toLowerCase()];

      resolve({
        translation: hit ? hit.translation : STUB_REPLY,
        detected_language: hit ? hit.detected : '',
        detected_code: hit ? hit.code : ''
      });
    }, 900);
  });
}

async function relayTranslate(text) {
  const res = await fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text,
      source_lang: fromSel.value,
      target_lang: toSel.value
    })
  });

  if (!res.ok) {
    throw new Error('relay responded ' + res.status);
  }

  return res.json();
}

/* ------------------------------------------------------------------ init */
buildLanguageOptions();
applyPaneLanguages();
updateCounter();
