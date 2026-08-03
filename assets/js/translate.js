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

   The real limits live in the relay: see relay/ratelimit.py, and the
   PHANTASLATE_* environment variables that configure it. If the numbers
   here and there ever disagree, the server wins and the visitor sees a
   confusing message. Keep them in sync.
   ===================================================================== */

const RELAY_URL   = 'https://api.phantaslate.com/translate';

/* Business plan v4.0 §4: one cap, both surfaces. The website used to be
   capped harder on the theory that it was a funnel toward the extension.
   That was wrong for phone and tablet users, who have no extension
   available — for them this page is the product, not a preview of it. */
const MAX_CHARS   = 5000;    // per request — must match PHANTASLATE_WEB_MAX_CHARS
const DAILY_CHARS = 30000;   // per day     — must match PHANTASLATE_WEB_DAILY_CHARS
const MIN_GAP_MS  = 1200;    // client-side debounce between submissions

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
      setStatus('Translated \u2014 the text may not be in the language you picked'
                + quotaSuffix(result._quota), 'notice');
    } else {
      setStatus('Translated \u00b7 nothing stored' + quotaSuffix(result._quota), 'idle');
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
  let res;
  try {
    res = await fetch(RELAY_URL, {
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
  } catch (networkErr) {
    /* fetch only rejects for network-level failures: CORS refusal, DNS,
       offline, TLS. There is no response and no status. Distinguishing
       this from an HTTP error matters — "the relay said no" and "the
       browser never let the request out" have completely different
       fixes. */
    const err = new Error('unreachable');
    err.status = 0;
    throw err;
  }

  if (!res.ok) {
    const err = new Error('relay ' + res.status);
    err.status = res.status;
    try {
      err.detail = (await res.json()).detail;
    } catch (_) { /* body wasn't JSON — the status alone is enough */ }
    throw err;
  }

  const body = await res.json();
  body._quota = readQuota(res);
  return body;
}

/* The relay reports remaining quota on every response. Returns null when
   the headers are absent — an older relay build, or a self-hosted one —
   so the UI shows nothing rather than inventing a number. */
function readQuota(res) {
  const remaining = parseInt(res.headers.get('X-RateLimit-Remaining'), 10);
  const limit     = parseInt(res.headers.get('X-RateLimit-Limit'), 10);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return null;
  return { remaining: remaining, limit: limit };
}

/* Only mention the number once it starts to matter. Announcing "29,847
   left" after translating one line turns a private tool into a metered
   one for no benefit; below a quarter remaining it's genuinely useful. */
function quotaSuffix(quota) {
  if (!quota) return '';
  if (quota.remaining > quota.limit * 0.25) return '';
  return ' \u00b7 ' + quota.remaining.toLocaleString() + ' left today';
}

/* Limit responses aren't errors from the visitor's point of view — they
   asked a reasonable thing and the answer is "not right now". Say so
   plainly.

   Note what is NOT here any more: this used to tell people the extension
   had a larger allowance. Under v4.0's equal caps that is false, and a
   false claim in a rate-limit message is worse than no claim — it sends
   someone to install something that won't help. */
function showFailure(err) {
  let message;
  let notice = false;

  switch (err.status) {
    case 0:
      message = 'Couldn\u2019t reach the translation service. '
              + 'Check your connection and try again.';
      break;
    case 429:
      // The relay distinguishes "you're out" from "this network is out",
      // and says which. Prefer its wording over a guess made here.
      message = err.detail
        || 'Daily limit reached for this browser. It resets at midnight UTC.';
      notice = true;
      break;
    case 413:
      message = 'That text is over the ' + MAX_CHARS.toLocaleString()
              + '-character limit for a single translation.';
      notice = true;
      break;
    case 503:
      /* Two different causes arrive as 503: the shared daily budget is
         spent (resets at midnight), or the relay is momentarily at
         capacity (retrying shortly works). Only the relay knows which,
         so its message is used when present. Suggesting the extension
         here would be pointless — both surfaces share the same budget. */
      message = err.detail
        || 'The service is busy right now. Please try again shortly.';
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
