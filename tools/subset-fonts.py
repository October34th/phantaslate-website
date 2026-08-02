"""
Strip the unused Latin glyphs out of the Be Vietnam Pro font files.

Why this exists
---------------
google-webfonts-helper merges subsets into one file per weight, so the
Be Vietnam Pro files ship with a full Latin alphabet this site never
draws from them. DM Sans owns Latin; Be Vietnam Pro is only ever asked
for Vietnamese diacritics, via the unicode-range rules in
assets/css/fonts.css.

The Latin glyphs are downloaded but never selected. This script removes
them, cutting each file from roughly 27KB to under 10KB.

This is entirely optional and runs on your machine only. Visitors to
phantaslate.com never run Python - they just download whatever .woff2
files are sitting in assets/fonts/. Running this makes those files
smaller; not running it changes nothing except page weight.

Requires
--------
    pip install fonttools brotli

Usage
-----
From anywhere:

    python tools/subset-fonts.py

Originals are backed up alongside the new files with a .original
extension, so a bad run is recoverable without re-downloading.
"""

import shutil
import sys
from pathlib import Path

try:
    from fontTools import subset
except ImportError:
    sys.exit("fontTools not found. Run:  pip install fonttools brotli")

try:
    import brotli  # noqa: F401  - not called directly, fontTools needs it for woff2
except ImportError:
    sys.exit("brotli not found. Run:  pip install brotli")


# Must match the unicode-range in assets/css/fonts.css exactly. If one
# changes, change the other - a glyph in the CSS range but missing from
# the font renders as a blank box.
VIETNAMESE_RANGES = (
    "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,"
    "U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,"
    "U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB"
)

TARGETS = ["be-vietnam-pro-400.woff2", "be-vietnam-pro-500.woff2"]


def main():
    fonts_dir = Path(__file__).resolve().parent.parent / "assets" / "fonts"

    if not fonts_dir.is_dir():
        sys.exit(f"Could not find {fonts_dir}\n"
                 "Run this script from inside the phantaslate-website folder.")

    print(f"Font folder: {fonts_dir}\n")

    total_before = 0
    total_after = 0

    for name in TARGETS:
        path = fonts_dir / name
        backup = path.with_suffix(".woff2.original")

        if not path.exists():
            print(f"  SKIP  {name} - not found")
            continue

        before = path.stat().st_size

        # Keep the untouched download around; re-running the script on an
        # already-subset file would otherwise silently do nothing useful.
        if not backup.exists():
            shutil.copy2(path, backup)

        subset.main([
            str(backup),
            f"--unicodes={VIETNAMESE_RANGES}",
            "--flavor=woff2",
            "--layout-features=*",
            f"--output-file={path}",
        ])

        after = path.stat().st_size
        total_before += before
        total_after += after

        pct = (1 - after / before) * 100
        print(f"  OK    {name}"
              f"  {before / 1024:6.1f} KB -> {after / 1024:5.1f} KB"
              f"  ({pct:.0f}% smaller)")

    if total_before:
        saved = (total_before - total_after) / 1024
        print(f"\n  Saved {saved:.1f} KB total.")
        print("  Originals kept as *.woff2.original - delete them once you've")
        print("  checked the site still renders Vietnamese correctly.")
    else:
        print("\n  Nothing to do.")


if __name__ == "__main__":
    main()
