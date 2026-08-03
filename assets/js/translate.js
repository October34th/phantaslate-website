/* =====================================================================
   Phantaslate — phantaslate.com
   assets/js/translate.js

   The hero panel, live. Sends text to the relay and shows the result.

   ---------------------------------------------------------------------
   The throttling in this file is COURTESY, NOT SECURITY
   ---------------------------------------------------------------------
   Everything below runs in the visitor's browser and can be bypassed by
   anyone who opens devtools, disables JavaScript, or sends requests with
   curl. It exists to stop honest accidents — a double-click, a stuck
   key, an impatient retry — from spending quota, and to show a useful
   message instead of a raw 429.

   The real limits live in the relay: see relay/web_limits.py in this
   repository, which is written to be dropped into the phantaslate relay
   repo. If the numbers here and there ever disagree, the server wins and
   the visitor sees a confusing message. Keep them in sync.
   ===================================================================== */

const RELAY_URL   = 'https://api.phantaslate.com/translate';

const MAX_CHARS   = 1000;   // per request — must match MAX_CHARS_PER_REQUEST
const DAILY_CHARS = 5000;   // per day     — must match DAILY_CHAR_CAP
const MIN_GAP_MS  = 1200;   // client-side debounce between submissions

/* The nine supported languages, CJKV first — the order reflects what the
   product is built for, not alphabetical convenience. */
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

let lastSubmit = 0;
let inFlight   = false;

/* A random, session-scoped identifier. Not tied to anything about the
   visitor, cleared when the tab closes, and trivially reset by anyone
   who wants to — which is fine, because it isn't a security control.
   It lets the relay tell two people behind one office NAT apart, which
   an IP hash alone cannot do. Documented in the privacy policy. */
function sessionToken() {
  try {
    let t = sessionStorage.getItem('pt');
    if (!t) {
      t = crypto.randomUUID();
      sessionStorage.setItem('pt', t);
    }
    return t;
  } catch (err) {
    // Private browsing or storage disabled. The relay falls back to the
    // IP hash alone, which is stricter, not looser.
    return '';
  }
}

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
  const n = source.value.length;
  counter.textContent = n + ' / ' + MAX_CHARS;
  counter.classList.toggle('is-near', n > MAX_CHARS * 0.9);
  clearBtn.hidden = n === 0;
}

function resetOutput() {
  output.textContent = '';
  output.classList.remove('is-notice');
  detected.textContent = '';
  copyBtn.hidden = true;
}

/* Han unification means Chinese and Japanese share codepoints but render
   them differently. Declaring the language on each pane lets the :lang()
   rules in fonts.css pick the right face. */
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
    setStatus('Your browser blocked the copy \u2014 select the text instead', 'error');
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
  if (output.textContent && !output.classList.contains('is-notice')) {
    source.value = output.textContent.slice(0, MAX_CHARS);
    resetOutput();
    updateCounter();
  }
  applyPaneLanguages();
});

fromSel.addEventListener('change', () => applyPaneLanguages());
toSel.addEventListener('change', () => applyPaneLanguages());

btn.addEventListener('click', translate);

/* ------------------------------------------------------------------ translate */
async function translate() {
  const text = source.value.trim();

  if (!text) {
    source.focus();
    setStatus('Type something to translate', 'idle');
    return;
  }

  if (inFlight) return;

  const since = Date.now() - lastSubmit;
  if (since < MIN_GAP_MS) {
    setStatus('One moment \u2014 give it a second between translations', 'notice');
    return;
  }

  inFlight   = true;
  lastSubmit = Date.now();
  btn.disabled = true;
  panes.classList.add('is-working');
  setStatus('Passing through\u2026', 'idle');
  resetOutput();

  try {
    const result = await callRelay(text);

    output.textContent = result.translation;
    applyPaneLanguages(result.detected_code);

    if (result.detected_language && fromSel.value === 'auto') {
      detected.textContent = 'Detected: ' + result.detected_language;
    }

    if (result.source_mismatch) {
      setStatus('Translated \u2014 the text may not be in the language you picked', 'notice');
    } else {
      setStatus('Translated \u00b7 nothing stored', 'idle');
    }

    copyBtn.hidden = false;

  } catch (err) {
    showFailure(err);
  } finally {
    panes.classList.remove('is-working');
    btn.disabled = false;
    inFlight = false;
  }
}

async function callRelay(text) {
  const res = await fetch(RELAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Phantaslate-Session': sessionToken()
    },
    body: JSON.stringify({
      text: text,
      source_lang: fromSel.value,
      target_lang: toSel.value
    })
  });

  if (!res.ok) {
    const err = new Error('relay ' + res.status);
    err.status = res.status;
    try {
      err.detail = (await res.json()).detail;
    } catch (_) { /* body wasn't JSON — the status alone is enough */ }
    throw err;
  }

  return res.json();
}

/* Limit responses aren't errors from the visitor's point of view — they
   asked a reasonable thing and the answer is "not right now". Say so
   plainly, and point at the extension, which is where the real allowance
   lives. */
function showFailure(err) {
  let message;
  let notice = false;

  switch (err.status) {
    case 429:
      message = err.detail
        || 'Daily limit reached for this browser. The extension gives you 20,000 characters a day \u2014 free, no account.';
      notice = true;
      break;
    case 413:
      message = 'That text is over the ' + MAX_CHARS + '-character limit for this page.';
      notice = true;
      break;
    case 503:
      message = 'The service is at capacity right now. Try again shortly, or install the extension.';
      notice = true;
      break;
    default:
      message = 'That request didn\u2019t go through. Try again in a moment.';
  }

  output.textContent = message;
  output.classList.add('is-notice');
  output.lang = 'en';
  setStatus(notice ? 'Limit reached \u00b7 nothing stored' : 'Failed \u00b7 nothing stored',
            notice ? 'notice' : 'error');
}

/* ------------------------------------------------------------------ init */
buildLanguageOptions();
applyPaneLanguages();
updateCounter();
