/* =====================================================================
   Phantaslate — phantaslate.com
   assets/js/demo.js

   The hero panel, fully interactive: pick languages, swap them, type,
   clear, copy. Everything a visitor would expect to be able to click,
   they can.

   What it deliberately does NOT do
   --------------------------------
   Translate. Every submission returns the same notice pointing at the
   extension. There is no phrasebook of canned results, because a canned
   result IS a translation result as far as a visitor is concerned —
   someone who types a word and gets the right answer back has been told
   this page translates, whatever a comment in the source says.

   There is also no fetch() anywhere in this file, no relay URL, and no
   code path that could reach the network. That isn't a flag that could
   be flipped by accident; the capability simply isn't here. The CSP in
   _headers backs it up with connect-src 'none', so restoring a real
   translator means changing both this file and that header on purpose.

   Why the site doesn't translate
   ------------------------------
   The relay's origin check, character cap and abuse handling were all
   built around the extension, which sends a known extension origin and
   carries an install token. A public web page has neither. Wiring this
   panel up before that exists would either fail oddly or cost money in
   ways nobody is watching.
   ===================================================================== */

const MAX_CHARS = 500;

/* The nine supported languages, CJKV first — the order reflects what the
   product is built for, not alphabetical convenience. Codes match the
   relay's own language codes. */
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

const DEMO_REPLY =
  'This is a demo panel — it doesn\u2019t translate. ' +
  'Install the extension and your text gets translated for real, ' +
  'without being stored or logged.';

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
  fromSel.add(new Option('Auto-detect', 'auto', true, true));

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
  output.classList.remove('is-notice');
  detected.textContent = '';
  copyBtn.hidden = true;
}

/* Han unification means Chinese and Japanese share codepoints but render
   them differently — a browser cannot tell one from the other without
   being told. Declaring the language on each pane lets the :lang() rules
   in fonts.css pick the right face. */
function applyPaneLanguages() {
  const from = fromSel.value;
  source.lang = (from === 'auto') ? '' : from;
  output.lang = toSel.value;
}

/* ------------------------------------------------------------------ events */
source.addEventListener('input', updateCounter);

source.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    submit();
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

el('swap').addEventListener('click', () => {
  if (fromSel.value === 'auto') {
    fromSel.value = toSel.value;
  } else {
    const held = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = held;
  }
  applyPaneLanguages();
});

fromSel.addEventListener('change', applyPaneLanguages);
toSel.addEventListener('change', applyPaneLanguages);

btn.addEventListener('click', submit);

/* ------------------------------------------------------------------ submit */
function submit() {
  const text = source.value.trim();

  if (!text) {
    source.focus();
    setStatus('Type something to try the panel', 'idle');
    return;
  }

  btn.disabled = true;
  panes.classList.add('is-working');
  setStatus('Passing through\u2026', 'idle');
  resetOutput();

  /* The pause is honest, not theatre: it shows the dissolving-trail
     motif doing what it does in the extension. What arrives at the end
     is a notice, not a translation. */
  window.setTimeout(() => {
    output.textContent = DEMO_REPLY;
    output.classList.add('is-notice');
    output.lang = 'en';
    setStatus('Demo only \u00b7 nothing sent, nothing stored', 'notice');

    panes.classList.remove('is-working');
    btn.disabled = false;
  }, 900);
}

/* ------------------------------------------------------------------ init */
buildLanguageOptions();
applyPaneLanguages();
updateCounter();
