"""Sanitize a saved social-media page into a shareable extractor test fixture.

Replaces handles, display names, numeric/short-code IDs, avatars and media URLs with
stable fakes (same input -> same fake) while preserving the DOM structure that the
extension's extractors rely on. Scripts, styles and tracking attributes are dropped.

Usage:
    python tools/sanitize_fixture.py .tmp/raw_pages/x_home.html --platform x \
        --url https://x.com/home --name feed [--redact-post-text]

Output: extension/tests/fixtures/<platform>/<name>.html (override with --out).
Post text is kept by default because extractors are tested against it. Use
--redact-post-text, or review the output by hand, before sharing a fixture.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Comment, Declaration, Doctype, NavigableString

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = PROJECT_ROOT / "extension" / "tests" / "fixtures"
SALT = "marketing-listener-fixture-v1"

CDN_HOSTS = ("twimg.com", "cdninstagram.com", "fbcdn.net")
KEEP_QUERY = {"format", "name", "stp"}
KEEP_REL_QUERY = {"hl", "q", "enable_persistent_cta", "entry_point"}
URL_ATTRS = ("src", "href", "poster", "srcset", "data-src", "content")
DROP_ATTRS = ("style", "nonce", "integrity", "data-lynx-uid", "data-ft", "data-gt")
DROP_TAGS = ("script", "noscript", "style", "template")

RESERVED = {
    "x": {"home", "explore", "search", "i", "hashtag", "messages", "notifications", "settings", "compose",
          "login", "logout", "account", "lists", "topics", "tos", "privacy", "about", "intent"},
    "instagram": {"explore", "p", "reel", "reels", "tv", "stories", "direct", "accounts", "about", "legal", "web",
                  "developer", "api", "ar", "privacy", "challenge", "emails", "notifications", "settings", "locations",
                  "tags", "audio"},
    "facebook": {"watch", "groups", "marketplace", "permalink.php", "profile.php", "photo", "photo.php",
                 "story.php", "reel", "hashtag", "messages", "notifications", "settings", "login",
                 "checkpoint", "events", "pages", "friends", "stories", "gaming", "help", "bookmarks"},
}

NAME_SELECTORS = {
    "x": ['[data-testid="User-Name"] a', '[data-testid="UserName"] span'],
    "instagram": ["header a[href^='/'] span", "header h1", "header h2"],
    "facebook": ["h1", "h2 a", "h3 a", "h4 a", '[data-ad-rendering-role="profile_name"] a'],
}

TEXT_SELECTORS = {
    "x": ['[data-testid="tweetText"]'],
    "instagram": ["article h1", 'article span[dir="auto"]'],
    "facebook": ['[data-ad-rendering-role="story_message"]', '[data-ad-comet-preview="message"]'],
}


# --fake-text: every text node that is not UI chrome, a count or a time stamp becomes deterministic filler.
FAKE_WORDS = (
    "river lantern copper meadow harbor violet ember cobalt willow juniper marble thistle amber falcon "
    "orchard quartz saffron timber velvet walnut zephyr bramble cinder dune fjord glacier hollow isle "
    "kettle lagoon mosaic nectar opal prairie quill ripple summit tundra umber vista yonder"
).split()
SAFE_WORDS = {
    "follow", "following", "followers", "follower", "posts", "post", "message", "more", "ad", "sponsored", "reels",
    "reel", "likes", "like", "comments", "comment", "views", "view", "plays", "all", "original", "audio", "photo",
    "video", "by", "on", "in", "with", "and", "others", "liked", "reply", "replies", "see", "translation", "instagram",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
    "december", "verified", "suggested", "for", "you", "sign", "up", "learn", "shop", "now", "send", "save",
    "share", "repost", "home", "search", "explore", "create", "profile", "tagged", "clip",
}
COUNT_TOKEN = re.compile(r"^[\d.,]+[KMBkmb]?$|^\d+(?:s|m|h|d|w|hrs?|mins?)$")
FAKE_ID = re.compile(r"^(?:user_[0-9a-f]{6}|User [0-9a-f]{6}|user\.page[0-9a-f]{5})$")
TOKEN_CORE = re.compile(r"^([^\w]*)(.*?)([^\w]*)$", re.S)
FAKE_ATTRS = ("alt", "title", "placeholder", "value")

LOOKS_LIKE_STAMP = re.compile(r"[\d.,:\sKMB]+(?:[smhdw]|hrs?|mins?|ago|[ap]m)?|[A-Z][a-z]{2,8} \d{1,2}(?:, \d{4})?", re.I)
PHONE = re.compile(r"(?<![\d-])(?:\+\d[\d\s().-]{8,}\d|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?![\d-])")


def digest(value: str) -> str:
    return hashlib.sha256(f"{SALT}:{value}".encode()).hexdigest()


def fake_digits(value: str, length: int) -> str:
    n = str(int(digest(value), 16))
    return ("1" + n)[:length].ljust(length, "7")


def fake_token(value: str, length: int) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    raw = int(digest(value), 16)
    out = []
    for _ in range(length):
        raw, idx = divmod(raw, len(alphabet))
        out.append(alphabet[idx])
    return "".join(out)


def fake_word(token: str) -> str:
    return FAKE_WORDS[int(digest("w:" + token.lower()), 16) % len(FAKE_WORDS)]


def fake_text(text: str) -> str:
    """Replaces words with stable fakes; keeps whitespace, punctuation, emoji, counts, time stamps and UI words."""
    if FAKE_ID.match(text.strip()):
        return text
    out = []
    for part in re.split(r"(\s+)", text):
        if not part or part.isspace() or FAKE_ID.match(part) or COUNT_TOKEN.match(part):
            out.append(part)
            continue
        lead, core, trail = TOKEN_CORE.match(part).groups()
        if not re.search(r"[^\W\d_]", core) or core.lower() in SAFE_WORDS or FAKE_ID.match(core):
            out.append(part)
        elif lead.endswith("#"):
            out.append(part[: len(lead)] + fake_word(core) + trail)
        elif lead.endswith("@"):
            out.append(part[: len(lead)] + "user_" + digest(core.lower())[:6] + trail)
        else:
            w = fake_word(core)
            out.append(lead + (w.capitalize() if core[:1].isupper() else w) + trail)
    return "".join(out)


class Sanitizer:
    def __init__(self, platform: str, fake_all_text: bool = False):
        self.fake_all_text = fake_all_text
        self.platform = platform
        self.handles: dict[str, str] = {}
        self.names: dict[str, str] = {}

    # ---- identity discovery -------------------------------------------------
    def discover(self, soup: BeautifulSoup) -> None:
        reserved = RESERVED[self.platform]
        for a in soup.find_all("a", href=True):
            handle = self._handle_from_href(a["href"], reserved)
            if handle:
                self._add_handle(handle)
        for text in soup.find_all(string=re.compile(r"(?<![\w.])@[A-Za-z0-9_.]{2,30}")):
            for m in re.finditer(r"(?<![\w.])@([A-Za-z0-9_]{2,30})", str(text)):
                self._add_handle(m.group(1))
        for el in soup.find_all(attrs={"alt": re.compile(r"@[A-Za-z0-9_.]{2,30}")}):
            for m in re.finditer(r"(?<![\w.])@([A-Za-z0-9_.]{2,30})", el["alt"]):
                self._add_handle(m.group(1).rstrip("."))
        for el in soup.find_all(attrs={"alt": re.compile(r"^(?:Photo|Video) by ")}):
            m = re.match(r"^(?:Photo|Video) by (.+?)(?: on |\.|$)", el["alt"])
            if m and len(m.group(1)) > 2:
                self.names.setdefault(m.group(1), "User " + digest(m.group(1))[:6])
        for selector in NAME_SELECTORS[self.platform]:
            for el in soup.select(selector):
                name = el.get_text(" ", strip=True)
                if name and not name.startswith("@") and len(name) > 2 and not LOOKS_LIKE_STAMP.fullmatch(name):
                    self.names.setdefault(name, "User " + digest(name)[:6])

    def _handle_from_href(self, href: str, reserved: set[str]) -> str | None:
        parts = urlsplit(href)
        if parts.netloc and not re.search(r"(x|twitter|instagram|facebook)\.com$", parts.netloc):
            return None
        segs = [s for s in parts.path.split("/") if s]
        if not segs:
            return None
        first = segs[0]
        if first.lower() in reserved:
            return None
        if self.platform == "x" and not re.fullmatch(r"[A-Za-z0-9_]{1,15}", first):
            return None
        if self.platform == "instagram" and not re.fullmatch(r"[\w.]{1,30}", first):
            return None
        return first

    def _add_handle(self, handle: str) -> None:
        key = handle.lower()
        if key in self.handles:
            return
        fake = "user_" + digest(key)[:6]
        if self.platform == "facebook":
            fake = "user.page" + digest(key)[:5]
        self.handles[key] = fake

    # ---- replacement --------------------------------------------------------
    def scrub(self, text: str) -> str:
        for original, fake in sorted(self.handles.items(), key=lambda kv: -len(kv[0])):
            text = re.sub(r"(?<![A-Za-z0-9])" + re.escape(original) + r"(?![A-Za-z0-9])", fake, text, flags=re.IGNORECASE)
        for original, fake in sorted(self.names.items(), key=lambda kv: -len(kv[0])):
            text = text.replace(original, fake)
        text = re.sub(r"(/explore/(?:locations/\d+|tags)/)([^/\"'\s?]+)", lambda m: m.group(1) + fake_word(m.group(2)), text)
        text = re.sub(r"\bpfbid[0-9A-Za-z]+", lambda m: "pfbid0" + fake_token(m.group(0), 20), text)
        text = re.sub(r"(/(?:p|reels?|tv)/)([\w-]{8,14})", lambda m: m.group(1) + fake_token(m.group(2), len(m.group(2))), text)
        text = re.sub(r"(?<![\w.])\d{10,}(?![\w.])", lambda m: fake_digits(m.group(0), len(m.group(0))), text)
        text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "person@example.com", text)
        text = PHONE.sub("000-000-0000", text)
        return text

    def scrub_url(self, value: str) -> str:
        def one(url: str) -> str:
            parts = urlsplit(url)
            host = parts.netloc.lower()
            if any(host.endswith(h) for h in CDN_HOSTS):
                segs = [fake_digits(x, len(x)) if x.isdigit() and len(x) >= 10 else x for x in parts.path.split("/")]
                ext = ""
                last = segs[-1]
                if "." in last:
                    last, ext = last.rsplit(".", 1)
                    ext = "." + ext
                size = re.search(r"_?(s\d+x\d+|normal|bigger|n)$", last)
                keep = size.group(0) if size else ""
                segs[-1] = fake_token(last, 14) + keep + ext
                query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k in KEEP_QUERY])
                return urlunsplit((parts.scheme, parts.netloc, "/".join(segs), query, ""))
            if host and not re.search(r"(x|twitter|instagram|facebook)\.com$", host) and parts.scheme.startswith("http"):
                return "https://example.com/"
            cleaned = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                       if k in {"story_fbid", "id", "fbid", "v", "q"}]
            return self.scrub(urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(cleaned), "")))

        if "://" in value:
            return re.sub(r"https?://[^\s\"',)]+", lambda m: one(m.group(0)), value)
        if value.startswith("/") and "?" in value:
            path, _, query = value.partition("?")
            kept = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True) if k in KEEP_REL_QUERY]
            value = path + ("?" + urlencode(kept) if kept else "")
        return self.scrub(value)

    def apply(self, soup: BeautifulSoup, redact_selectors: list[str]) -> None:
        for tag in soup.find_all(DROP_TAGS):
            tag.decompose()
        for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
            c.extract()
        for link in soup.find_all("link"):
            link.decompose()
        for meta in soup.find_all("meta"):
            keep = meta.get("charset") or meta.get("property") == "og:description" or meta.get("name") == "viewport"
            if not keep:
                meta.decompose()
        for selector in redact_selectors:
            for el in soup.select(selector):
                words = max(3, len(el.get_text().split()))
                el.clear()
                el.append(NavigableString(" ".join(["Lorem", "ipsum", "dolor", "sit", "amet"] * 20)[: words * 6].strip()))
        for el in soup.find_all(True):
            for attr in list(el.attrs):
                if attr in DROP_ATTRS or attr.startswith("on"):
                    del el.attrs[attr]
                    continue
                value = el.attrs[attr]
                if isinstance(value, list):
                    el.attrs[attr] = [self.scrub(v) for v in value]
                elif attr in URL_ATTRS or "://" in value:
                    el.attrs[attr] = self.scrub_url(value)
                else:
                    el.attrs[attr] = self.scrub(value)
                    if self.fake_all_text and attr in FAKE_ATTRS:
                        el.attrs[attr] = fake_text(el.attrs[attr])
        for node in soup.find_all(string=True):
            if isinstance(node, (Comment, Doctype, Declaration)):
                continue
            text = self.scrub(str(node))
            node.replace_with(fake_text(text) if self.fake_all_text else text)

    def leaks(self, html: str) -> list[str]:
        low = html.lower()
        found = [h for h in self.handles if re.search(r"(?<![a-z0-9])" + re.escape(h) + r"(?![a-z0-9])", low)]
        found += [n for n in self.names if n.lower() in low]
        return found


def sanitize(html: str, platform: str, url: str, redact_post_text: bool = False,
             fake_all_text: bool = False) -> tuple[str, Sanitizer]:
    soup = BeautifulSoup(html, "html.parser")
    s = Sanitizer(platform, fake_all_text)
    s.discover(soup)
    s.apply(soup, TEXT_SELECTORS[platform] if redact_post_text else [])
    if not soup.head:
        soup.html.insert(0, soup.new_tag("head")) if soup.html else None
    head = soup.head or soup
    if not head.find("meta", charset=True):
        head.insert(0, soup.new_tag("meta", charset="utf-8"))
    meta = soup.new_tag("meta", attrs={"name": "fixture-url", "content": s.scrub_url(url)})
    head.insert(1, meta)
    return str(soup), s


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="saved page, e.g. .tmp/raw_pages/x_home.html")
    ap.add_argument("--platform", required=True, choices=sorted(RESERVED))
    ap.add_argument("--url", help="URL the page was saved from (used for surface detection); default: the "
                                  "fixture-url meta that the extension's snapshot button records")
    ap.add_argument("--name", help="fixture name (default: input file stem)")
    ap.add_argument("--out", type=Path, help="explicit output path")
    ap.add_argument("--redact-post-text", action="store_true", help="replace post text with filler")
    ap.add_argument("--fake-text", action="store_true",
                    help="replace every word that is not UI chrome, a count or a time stamp with stable filler "
                         "(captions, bios, audio titles, alt text); structure and aria-labels are kept")
    args = ap.parse_args(argv)

    html = args.input.read_text(encoding="utf-8", errors="replace")
    if not args.url:
        found = re.search(r'<meta[^>]*name="fixture-url"[^>]*content="([^"]*)"', html) or             re.search(r'<meta[^>]*content="([^"]*)"[^>]*name="fixture-url"', html)
        if not found:
            ap.error("--url is required: this page carries no fixture-url meta (saved before snapshots recorded it)")
        args.url = found.group(1).replace("&amp;", "&")
    out_html, s = sanitize(html, args.platform, args.url, args.redact_post_text, args.fake_text)
    out = args.out or FIXTURE_ROOT / args.platform / f"{args.name or args.input.stem}.html"
    leaks = s.leaks(out_html)
    if leaks:
        print(f"ERROR: {len(leaks)} original identifier(s) survived sanitizing; not writing {out}", file=sys.stderr)
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(out_html, encoding="utf-8")
    print(f"wrote {out} ({len(s.handles)} handles, {len(s.names)} names replaced)")
    print("Next: write <name>.expected.json by hand, review the HTML for free text, add an extractor test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
