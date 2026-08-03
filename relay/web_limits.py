"""
Phantaslate relay — web-origin limits
=====================================

Drop this into the *relay* repository (github.com/October34th/phantaslate),
not the website repo. It lives here so the website's client-side numbers
and the server's real ones can be reviewed together.

What this enforces
------------------
The extension and the website are different threat surfaces. The extension
sends a known extension origin and carries an install token; a public web
page has neither, and anyone can point curl at the endpoint. These limits
apply to *web* traffic only — extension requests keep their existing path
and their 20,000/day allowance, untouched.

    per request      1,000 characters
    per identifier   5,000 characters/day
                     5 requests/minute
                     30 requests/hour
    global           5,000,000 characters/day  (circuit breaker)

At DeepSeek pricing the global ceiling is roughly $0.60/day — about $18 a
month worst case. That is the number protecting you from a genuinely bad
day, and it is the one to revisit first if the site gets popular.

Identifying a visitor without accounts
--------------------------------------
Two signals, combined:

  1. A salted, rotating hash of the IP address. The raw IP is never
     stored. The salt rotates daily, so hashes cannot be correlated
     across days.
  2. A random session token the browser generates and sends in a header.
     Not derived from anything about the visitor, cleared when the tab
     closes, and resettable by anyone who wants to.

Neither is a security control and the second is trivially bypassed. The
combination exists so that many people behind one office NAT are not
throttled as though they were one person, which an IP hash alone would
do. Both are documented in the privacy policy — the site claims not to
profile visitors, and that claim has to survive contact with this file.

!! DEPLOYMENT CAVEAT — READ BEFORE SHIPPING !!
----------------------------------------------
The counters below are in-process memory. That means:

  * They reset on every deploy and every cold start. On Render's free
    tier, which sleeps idle services, that could be several times a day —
    effectively handing out fresh quota each time.
  * They are per-instance. If the relay ever runs more than one worker or
    scales beyond one instance, each gets its own independent counters and
    the real limits multiply accordingly.

For launch on a single always-on instance this is acceptable, and it keeps
the stateless promise clean: nothing touches a disk. Before scaling, move
the counters to Redis with TTLs — the interface below is deliberately
narrow so swapping the backing store touches one class.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException, Request

# ---------------------------------------------------------------- limits

MAX_CHARS_PER_REQUEST = 1_000

# Per browser session. Generous enough that a real visitor evaluating the
# product never hits it.
DAILY_CHAR_CAP = 5_000
REQUESTS_PER_MINUTE = 5
REQUESTS_PER_HOUR = 30

# Per IP address, ignoring the session token entirely.
#
# This tier exists because the session token is client-supplied and can be
# rotated at will — clearing sessionStorage hands out a fresh allowance.
# Without a token-independent ceiling, the daily cap above is decorative:
# a trivial script rotating tokens gets unlimited quota from one address.
#
# Set well above DAILY_CHAR_CAP so genuine shared connections — an office,
# a campus, a mobile carrier's NAT — are not punished for having many real
# users behind one address.
IP_DAILY_CHAR_CAP = 25_000
IP_REQUESTS_PER_HOUR = 90

GLOBAL_DAILY_CHAR_CAP = 5_000_000

# Ceiling on tracked identifiers, so a flood of distinct keys cannot
# exhaust memory. When exceeded, the least recently seen are dropped —
# they are only counters, and losing one costs at most one visitor's
# remaining allowance for the day.
MAX_TRACKED_IDENTIFIERS = 50_000

# Origins permitted to use the web path. Anything else is rejected before
# a single character reaches the translation provider.
ALLOWED_WEB_ORIGINS = {
    "https://phantaslate.com",
    "https://www.phantaslate.com",
}

# Convenience for local development. Never set this in production.
if os.getenv("PHANTASLATE_ALLOW_LOCALHOST") == "1":
    ALLOWED_WEB_ORIGINS |= {
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }

_DAY = 86_400


# ---------------------------------------------------------------- identity


class SaltRotator:
    """Provides a salt that changes daily.

    Rotation is what stops today's hashes being comparable with
    yesterday's. Without it, a stable hash of an IP is a durable
    pseudonymous identifier — precisely the thing the privacy policy says
    does not exist here.
    """

    def __init__(self) -> None:
        self._salt = secrets.token_bytes(32)
        self._day = int(time.time() // _DAY)

    def current(self) -> bytes:
        today = int(time.time() // _DAY)
        if today != self._day:
            self._salt = secrets.token_bytes(32)
            self._day = today
        return self._salt


_salt = SaltRotator()


def client_ip(request: Request) -> str:
    """Best-effort client IP.

    Render sits behind a proxy, so the socket address is the proxy's.
    X-Forwarded-For's leftmost entry is the original client. It is
    trivially spoofable by a determined caller — which is one more reason
    these limits are a cost control rather than a security boundary.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _hash(raw: bytes) -> str:
    return hashlib.blake2b(raw, key=_salt.current(), digest_size=16).hexdigest()


def identifier(request: Request, session_token: str | None) -> str:
    """Per-browser key. The raw IP is hashed immediately and never stored.

    The session token, when present, is mixed in so separate visitors
    sharing one IP get separate allowances.
    """
    raw = b"sess|" + client_ip(request).encode("utf-8")
    if session_token:
        raw += b"|" + session_token.encode("utf-8")[:64]
    return _hash(raw)


def ip_identifier(request: Request) -> str:
    """Per-address key, deliberately ignoring the session token.

    Namespaced separately from identifier() so the two counters can never
    collide on the same key when no token is sent.
    """
    return _hash(b"ip|" + client_ip(request).encode("utf-8"))


# ---------------------------------------------------------------- counters


@dataclass
class Usage:
    chars_today: int = 0
    day: int = 0
    last_seen: float = 0.0
    recent: deque[float] = field(default_factory=deque)


class LimitStore:
    """In-memory usage counters. See the deployment caveat at the top."""

    def __init__(self) -> None:
        self._by_id: dict[str, Usage] = {}
        self._global_chars = 0
        self._global_day = int(time.time() // _DAY)

    def _sweep(self, usage: Usage, now: float) -> None:
        """Drop request timestamps older than an hour.

        Bounded by REQUESTS_PER_HOUR, so a deque per identifier stays
        small. Entries for identifiers that stop appearing are cleared by
        _evict_stale rather than lingering forever.
        """
        cutoff = now - 3600
        while usage.recent and usage.recent[0] < cutoff:
            usage.recent.popleft()

    def _evict_stale(self, now: float) -> None:
        """Keep the identifier table bounded.

        First drop anything untouched since before today. If that still
        leaves too many — which is what a flood of distinct keys produces,
        since all of them are from today — drop the least recently seen
        until back under the ceiling.
        """
        if len(self._by_id) <= MAX_TRACKED_IDENTIFIERS:
            return

        today = int(now // _DAY)
        for k in [k for k, u in self._by_id.items() if u.day < today]:
            del self._by_id[k]

        if len(self._by_id) <= MAX_TRACKED_IDENTIFIERS:
            return

        surplus = len(self._by_id) - MAX_TRACKED_IDENTIFIERS
        oldest = sorted(self._by_id.items(), key=lambda kv: kv[1].last_seen)
        for k, _ in oldest[:surplus]:
            del self._by_id[k]

    def _check_key(
        self,
        key: str,
        chars: int,
        now: float,
        today: int,
        char_cap: int,
        per_minute: int | None,
        per_hour: int,
        over_daily_detail: str,
    ) -> Usage:
        """Check one counter without committing. Raises on rejection.

        Deliberately does NOT insert into the table. A rejected request
        must leave no trace behind, or a flood of bad requests grows the
        table without ever reaching the eviction pass at the end of
        check_and_consume.
        """
        usage = self._by_id.get(key)
        if usage is None:
            usage = Usage()

        if usage.day != today:
            usage.day = today
            usage.chars_today = 0

        self._sweep(usage, now)

        if per_minute is not None:
            in_last_minute = sum(1 for ts in usage.recent if ts > now - 60)
            if in_last_minute >= per_minute:
                raise HTTPException(
                    status_code=429,
                    detail="That's a lot at once — give it a minute and try again.",
                )

        if len(usage.recent) >= per_hour:
            raise HTTPException(
                status_code=429,
                detail="Hourly limit reached. Try again later, or install the extension.",
            )

        if usage.chars_today + chars > char_cap:
            raise HTTPException(status_code=429, detail=over_daily_detail)

        return usage

    def check_and_consume(self, session_key: str, ip_key: str, chars: int) -> None:
        """Raise HTTPException if any limit would be exceeded, else record use.

        Both counters must pass before either is incremented — otherwise a
        request rejected by the second tier would still have consumed
        quota from the first.
        """
        now = time.time()
        today = int(now // _DAY)

        # --- global circuit breaker -----------------------------------
        if today != self._global_day:
            self._global_day = today
            self._global_chars = 0

        if self._global_chars + chars > GLOBAL_DAILY_CHAR_CAP:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Phantaslate is at capacity for today. The browser "
                    "extension has its own allowance and is unaffected."
                ),
            )

        # --- per browser session --------------------------------------
        session_usage = self._check_key(
            session_key, chars, now, today,
            char_cap=DAILY_CHAR_CAP,
            per_minute=REQUESTS_PER_MINUTE,
            per_hour=REQUESTS_PER_HOUR,
            over_daily_detail=(
                f"Daily limit reached for this browser "
                f"({DAILY_CHAR_CAP:,} characters). The extension gives you "
                f"20,000 a day — free, no account."
            ),
        )

        # --- per IP address, token-independent -------------------------
        ip_usage = self._check_key(
            ip_key, chars, now, today,
            char_cap=IP_DAILY_CHAR_CAP,
            per_minute=None,          # the session tier already covers bursts
            per_hour=IP_REQUESTS_PER_HOUR,
            over_daily_detail=(
                "Daily limit reached for this network. If you're on a shared "
                "connection, the extension has its own separate allowance."
            ),
        )

        # --- commit, only once both tiers agreed ----------------------
        for key, usage in ((session_key, session_usage), (ip_key, ip_usage)):
            usage.chars_today += chars
            usage.recent.append(now)
            usage.last_seen = now
            self._by_id[key] = usage

        self._global_chars += chars
        self._evict_stale(now)


_store = LimitStore()


# ---------------------------------------------------------------- guard


async def enforce_web_limits(
    request: Request,
    text: str,
    origin: str | None = None,
    x_phantaslate_session: str | None = None,
) -> None:
    """Call this at the top of the web translate handler.

    Raises HTTPException on rejection; returns None and records usage on
    success. Deliberately does not see, log, or retain the text itself —
    only its length.
    """
    if origin not in ALLOWED_WEB_ORIGINS:
        raise HTTPException(status_code=403, detail="Origin not permitted.")

    chars = len(text)

    if chars == 0:
        raise HTTPException(status_code=400, detail="Nothing to translate.")

    if chars > MAX_CHARS_PER_REQUEST:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Text is over the {MAX_CHARS_PER_REQUEST:,}-character limit "
                f"for the website. The extension handles 5,000 per translation."
            ),
        )

    _store.check_and_consume(
        identifier(request, x_phantaslate_session),
        ip_identifier(request),
        chars,
    )


# ---------------------------------------------------------------- wiring
#
# In the relay's main app, the web endpoint becomes roughly:
#
#     from fastapi import Depends, Header, Request
#     from web_limits import enforce_web_limits
#
#     @app.post("/translate")
#     async def translate(
#         payload: TranslateRequest,
#         request: Request,
#         origin: str | None = Header(default=None),
#         x_phantaslate_session: str | None = Header(default=None),
#     ):
#         await enforce_web_limits(
#             request,
#             payload.text,
#             origin=origin,
#             x_phantaslate_session=x_phantaslate_session,
#         )
#         return await do_translation(payload)
#
# CORS also needs the custom header allowed, or the browser rejects the
# response before your code sees it:
#
#     app.add_middleware(
#         CORSMiddleware,
#         allow_origins=sorted(ALLOWED_WEB_ORIGINS),
#         allow_methods=["POST"],
#         allow_headers=["Content-Type", "X-Phantaslate-Session"],
#     )
#
# Extension traffic must keep its existing origin check and its own
# 20,000/day path. Routing it through enforce_web_limits would silently
# cut every extension user to 5,000.
