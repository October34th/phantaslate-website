Installed font files
====================

    plus-jakarta-sans-700.woff2    headings          latin + vietnamese
    plus-jakarta-sans-800.woff2    hero, wordmark    latin + vietnamese
    dm-sans-400.woff2              body text         latin
    dm-sans-500.woff2              labels, buttons   latin
    be-vietnam-pro-400.woff2       body, VI only     latin + vietnamese
    be-vietnam-pro-500.woff2       labels, VI only   latin + vietnamese

Names are canonical, not the ones google-webfonts-helper hands you.
Rename on the way in — fonts.css looks for exactly these six.


How Vietnamese works here
=========================

DM Sans has no Vietnamese glyphs published by Google, at any weight, in
any subset. Nothing to re-download from its side.

fonts.css loads Be Vietnam Pro under the SAME font-family name,
'DM Sans', scoped with unicode-range to just the codepoints DM Sans is
missing. The browser resolves per character — DM Sans for Latin, Be
Vietnam Pro for Vietnamese diacritics. Every rule that says
font-family: var(--body) picks this up with no changes.

Plus Jakarta Sans needs none of that: it has a real Vietnamese subset
of its own, and the installed 700/800 files are the latin+vietnamese
cuts, so Vietnamese headings work natively.


Not installed, deliberately
===========================

    be-vietnam-pro-700.woff2 / -800.woff2
        Downloaded but unused. Be Vietnam Pro only ever fills gaps in
        the BODY face, which is set at 400 and 500. Headings are Plus
        Jakarta Sans. Installing these would ship ~58KB nobody requests.

    plus-jakarta-sans-400.woff2
        The display face is only ever set at 700 and 800.

    latin-ext on anything
        Covers Polish, Czech, Turkish and similar — none of which are
        among the nine supported languages.


Known inefficiency
==================

The be-vietnam-pro files are latin+vietnamese, because gwfh merges
selected subsets into one file per weight — vietnamese alone isn't
offered. Each file therefore carries a full Latin alphabet this site
never draws from it: roughly 19KB of the 27KB is dead weight.

It is not a correctness problem. unicode-range means those Latin glyphs
are never selected, only downloaded. And the files only download at all
when a Vietnamese character is actually on the page.

If page weight becomes a real constraint, run the bundled script:

    pip install fonttools brotli
    cd C:\PersonalDocumentsLocal\ClaudeLocalFileFolder\phantaslate-website
    python tools\subset-fonts.py

It handles both files, keeps .original backups, and prints the sizes
before and after. No arguments to type.

Do NOT paste a multi-line pyftsubset command into PowerShell. The
backslash line-continuation in most examples online is bash syntax;
PowerShell uses a backtick and will throw "Missing expression after
unary operator" on the backslash version. The script exists to avoid
that entirely.

If you ever change the unicode-range in assets/css/fonts.css, change
VIETNAMESE_RANGES in tools/subset-fonts.py to match. A codepoint listed
in the CSS but subsetted out of the font renders as a blank box.
