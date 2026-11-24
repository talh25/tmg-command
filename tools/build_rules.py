#!/usr/bin/env python3
"""Build site/data/rules.json from the StarCraft TMG rulebook text dumps.

Inputs (default: the Android companion's assets/rules folder, override with --src):
  core_rules.txt   `pdftotext -layout` output of the Core Rules Book (pages split by \\f)
  glossary.tsv     term \\t definition \\t reference
  faq_qa.tsv       question \\t answer
  abilities.tsv    faction \\t name \\t type \\t text \\t source

The difficult part is core_rules.txt: most pages are laid out in 2-3 columns
(plus a narrow sidebar for "DESIGNER'S NOTE" / "Abathur's TIP" boxes) printed
side by side on the same text lines.  Each page is de-columnised like this:

  1. Gutters are character positions that are blank on (nearly) every line,
     in runs >= 3 wide.  A gutter that runs down the whole page with no line
     crossing it cuts the page into vertical strips (page columns / sidebar).
     If a picture splits the page into bands, the band-by-band order is used
     instead when the text joins up better that way.
  2. Inside a strip the lines are cut into blocks at blank lines; neighbouring
     blocks with the same gutters are merged, and each merged group is read
     column by column, top to bottom.
  3. Groups with several columns but no running text are tables; so are the
     pages of Part 12.10-12.12 and the titled reference tables (LoS / Cover /
     Mission Markers / ability summary / 12.8).  Table rows become blocks
     whose text is the cells joined with " · " (the cells are kept as well).

The resulting stream of lines is then split on headings (driven by the table
of contents, which is the authoritative list of sections), and reflowed into
paragraphs / list items / sub-headings / notes.

Usage: python3 tools/build_rules.py [--src DIR] [--out FILE] [--debug FILE]
"""

import argparse
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = "/Users/talhorowitzhorine/Liad/SC-TMG-Companion/app/src/main/assets/rules"
DEFAULT_OUT = os.path.join(HERE, "..", "site", "data", "rules.json")

# Book page N is PDF page N + 2 (the cover and inside cover are unnumbered).
PAGE_OFFSET = 2
MIN_GUTTER = 3

# --------------------------------------------------------------------------
# Character clean-up
# --------------------------------------------------------------------------


def clean_chars(s):
    """Normalise the odd glyphs pdftotext leaves behind."""
    s = s.replace("\u200a", "").replace("\xad", "")
    # \uf0c5 / \uf0c6 are arrow icons: meaningful between items
    # ("Priority 1 → 2 → 3", "Control Markers → Score VP"), decorative elsewhere
    # (the "back to contents" arrow, arrows next to pictures).
    s = re.sub("(\\S) {0,2}[\uf0c5\uf0c6] {0,2}(?=\\S)", "\\1 → ", s)
    s = re.sub("(\\S) ?[\uf0c5\uf0c6](?= {2,}|$)", "\\1 →", s)  # arrow ending a column line
    # \uf0c7 is the "replacement" icon printed in front of FOR [Weapon].
    s = re.sub("\uf0c7(?= ?FOR\\b)", "\u21c4", s)
    s = re.sub("[\uf000-\uf0ff]", " ", s)  # other icons (down arrows ...)
    s = s.replace("\u02ee", "\u201d")
    return s


# --------------------------------------------------------------------------
# De-columnising
# --------------------------------------------------------------------------


def find_gutters(lines, min_width=MIN_GUTTER, strict=False, loose=False):
    """Return [(start, end)] blank runs that separate columns in `lines`.

    A position counts as blank if (almost) no non-empty line has a character
    there.  Big blocks tolerate a few intruding lines (pdftotext sometimes
    starts a column line one character early).
    """
    rows = [l for l in lines if l.strip()]
    if not rows:
        return []
    width = max(len(l) for l in rows)
    occ = [0] * width
    for l in rows:
        for i, ch in enumerate(l):
            if ch != " ":
                occ[i] += 1
    tol = 0 if strict else len(rows) // (10 if loose else 25)
    left = min(len(l) - len(l.lstrip()) for l in rows)
    gutters = []
    i = left
    while i < width:
        if occ[i] <= tol:
            j = i
            while j < width and occ[j] <= tol:
                j += 1
            if j < width and j - i >= min_width:
                gutters.append((i, j))
            i = j
        else:
            i += 1
    return gutters


def cut_line(line, gutters):
    """Split one line at the given gutters, tolerating small intrusions."""
    cuts = []
    for a, b in gutters:
        seg = line[a:b]
        if not seg.strip():
            cuts.append((a + b) // 2)
            continue
        # The line pokes into the gutter.  If it only has text on one side,
        # keep that text whole; otherwise cut at the widest space run nearby.
        if not line[b:].strip():
            cuts.append(max(len(line), a))
            continue
        if not line[:a].strip():
            cuts.append(min(len(line) - len(line.lstrip()), a))
            continue
        best = None
        for m in re.finditer(r" +", line[max(0, a - 2):b + 2]):
            s, e = m.start() + max(0, a - 2), m.end() + max(0, a - 2)
            if best is None or e - s > best[1] - best[0]:
                best = (s, e)
        cuts.append((best[0] + best[1]) // 2 if best else a)
    parts, prev = [], 0
    for c in cuts:
        parts.append(line[prev:c])
        prev = c
    parts.append(line[prev:])
    return parts


def intrudes(lines, gutters):
    """Does any line put text in the middle of one of the gutters?"""
    return any(l[a + 1:b - 1].strip() for l in lines for a, b in gutters)


def column_starts(lines, gutters):
    """Left edge of each column (min indentation of its text)."""
    starts = [None] * (len(gutters) + 1)
    for l in lines:
        if not l.strip():
            continue
        x = 0
        for ci, part in enumerate(cut_line(l, gutters)):
            if part.strip():
                s = x + len(part) - len(part.lstrip())
                starts[ci] = s if starts[ci] is None else min(starts[ci], s)
            x += len(part)
    return [s for s in starts if s is not None]


def merge_gutters(gut, group_lines, b_lines, tol=3):
    """Gutters to read group + block b with, or None if b does not belong.

    Normally b belongs if its columns start where the group's do and none of
    its lines runs across the group's gutters.  A block with extra gutters of
    its own is also accepted when those lie well inside one of the group's
    columns: that is a small table printed inside a column.
    """
    gb = find_gutters(b_lines)
    sg = column_starts(group_lines, gut)
    sb = column_starts(b_lines, gb)
    small, big = (sg, sb) if len(sg) <= len(sb) else (sb, sg)
    if all(any(abs(x - y) <= tol for y in big) for x in small):
        # strict: a line of b running across a gutter (a caption under two
        # columns) must not be swallowed by the intrusion tolerance
        gm = find_gutters(group_lines + b_lines, strict=True)
        if len(gm) == max(len(gut), len(gb)):
            return gm
        if len(gut) >= len(gb) and not intrudes(b_lines, gut):
            return gut
    if gut and len(gb) > len(gut) and not intrudes(b_lines, gut):
        for g0, g1 in gb:
            same = any(abs(g0 - a0) <= tol and abs(g1 - a1) <= tol for a0, a1 in gut)
            inside = all(g1 < a0 - tol or g0 > a1 + tol for a0, a1 in gut)
            if not (same or inside):
                return None
        return gut
    return None


def is_prose(col):
    """Running text fills most of its column width; table cells do not."""
    texts = [x.strip() for x in col if x.strip()]
    if len(texts) < 2:
        return bool(texts) and len(texts[0]) >= 45
    width = max(len(x) for x in texts)
    if sum(1 for x in texts if BULLET_RE.match(x)) >= 2 and width >= 38:
        return True  # a bullet list
    filled = sum(1 for x in texts if len(x) >= 0.75 * width)
    return width >= 38 and filled >= 0.5 * len(texts)


def split_spanning(block):
    """Split a block at lines that run straight across a column gutter
    (e.g. a picture caption printed under two columns with no blank line)."""
    if len(block) < 6:
        return [block]
    gut = find_gutters(block, loose=True)
    out, cur = [], []
    for l in block:
        if crosses([l], gut):
            if cur:
                out.append(cur)
            out.append([l])
            cur = []
        else:
            cur.append(l)
    if cur:
        out.append(cur)
    return out


def crosses(lines, gutters):
    """Does any line run straight through one of the gutters (text on both
    sides and no double space inside the gutter)?"""
    return any(l[:a].strip() and l[b:].strip() and "  " not in l[max(0, a - 1):b + 1]
               for l in lines for a, b in gutters)


def junction(prev, nxt):
    """How well does text chunk `nxt` continue chunk `prev`?"""
    a = [l.strip() for l in prev if l.strip()]
    b = [l.strip() for l in nxt if l.strip()]
    if not a or not b:
        return 0
    ended = bool(re.search(r"[.!?:][”’\")]*$", a[-1]))
    first = b[0][0]
    if ended:
        return -1 if first.islower() else 0.5
    return 1 if first.islower() else 0


def decolumnise(page_lines):
    """Read a page in reading order.

    Pages are read column by column.  But when a picture splits a page into
    horizontal bands with the same columns, the text may instead flow band
    by band (left column, right column, then the next band).  We pick the
    order in which the chunks of text join up best.
    """
    bands, cur, gap = [], [], 0
    for l in page_lines:
        if l.strip():
            if gap >= 3 and cur:
                bands.append(cur)
                cur = []
            gap = 0
            cur.append(l)
        else:
            gap += 1
            cur.append("")
    if cur:
        bands.append(cur)
    if len(bands) > 1:
        chunks = []
        for b in bands:
            gut = [g for g in find_gutters(b, strict=True) if not crosses(b, [g])]
            cols = [[] for _ in range(len(gut) + 1)]
            for l in b:
                for ci, part in enumerate(cut_line(l, gut) if l.strip() else [""] * len(cols)):
                    cols[ci].append(part)
            chunks.append([c for c in cols if any(x.strip() for x in c)])
        if len({len(c) for c in chunks}) == 1 and len(chunks[0]) > 1:
            ncol = len(chunks[0])
            col_major = [chunks[bi][ci] for ci in range(ncol) for bi in range(len(chunks))]
            band_major = [chunks[bi][ci] for bi in range(len(chunks)) for ci in range(ncol)]
            score = lambda seq: sum(junction(x, y) for x, y in zip(seq, seq[1:]))
            if score(band_major) > score(col_major):
                for b in bands:
                    yield from decolumnise_page(b)
                return
    yield from decolumnise_page(page_lines)


def decolumnise_page(page_lines):
    """Read a page column by column (see decolumnise_strip for the events).

    If some gutter runs down the whole page without any line crossing it,
    the page is first cut into vertical strips there and each strip is read
    on its own; this keeps a column together even when a table or picture
    beside it changes the layout of the other columns half way down.
    """
    gut = [g for g in find_gutters(page_lines, strict=True) if not crosses(page_lines, [g])]
    # drop gutters that would cut off a sliver (the first column of a table,
    # picture labels) rather than a page column
    changed = True
    while changed and gut:
        changed = False
        bounds = [0] + [(a + b) // 2 for a, b in gut] + [10 ** 4]
        for k in range(len(bounds) - 1):
            seg = [l[bounds[k]:bounds[k + 1]].strip() for l in page_lines]
            if max(len(x) for x in seg) < 15:
                del gut[min(k, len(gut) - 1)]
                changed = True
                break
    if not gut:
        yield from decolumnise_strip(page_lines)
        return
    strips = [[] for _ in range(len(gut) + 1)]
    for l in page_lines:
        parts = cut_line(l, gut) if l.strip() else [""] * (len(gut) + 1)
        x = 0
        for si, part in enumerate(parts):
            # keep absolute positions so gutters stay comparable
            strips[si].append((" " * x + part).rstrip() if part.strip() else "")
            x += len(part)
    widths = []
    for st in strips:
        texts = [l for l in st if l.strip()]
        ind = min((len(l) - len(l.lstrip()) for l in texts), default=0)
        widths.append(max((len(l) for l in texts), default=0) - ind)
    for st, w in zip(strips, widths):
        # a narrow strip beside full-width text is the sidebar
        yield from decolumnise_strip(st, side_strip=w <= 32 and max(widths) >= 45)


def decolumnise_strip(page_lines, side_strip=False):
    """Yield the page in reading order as events:

      ("col", index, width, is_sidebar) followed by that column's ("line", text)
      events (blank rows as ""), or ("table", raw_lines) for a group that is a
      grid of short cells rather than running text.
    """
    # 1. blocks separated by blank lines
    blocks, cur = [], []
    for l in page_lines:
        if l.strip():
            cur.append(l)
        else:
            if cur:
                blocks.append(cur)
            cur = []
            if blocks and blocks[-1] != [""]:
                blocks.append([""])  # remember the blank row
    if cur:
        blocks.append(cur)
    blocks = [piece for b in blocks for piece in split_spanning(b)]
    # 2-3. merge compatible neighbours (blank rows travel with the group)
    groups = []  # [lines, gutters]
    for b in blocks:
        if b == [""]:
            if groups:
                groups[-1][0].append("")
            continue
        merged = merge_gutters(groups[-1][1], [l for l in groups[-1][0] if l], b) if groups else None
        if merged is not None:
            groups[-1][0].extend(b)
            groups[-1][1] = merged
        else:
            groups.append([list(b), find_gutters(b)])
    # 4. read columns
    for g, gut in groups:
        ncol = len(gut) + 1
        cols = [[] for _ in range(ncol)]
        for l in g:
            parts = cut_line(l, gut) if l.strip() else [""] * ncol
            for ci in range(ncol):
                cols[ci].append(parts[ci].rstrip() if ci < len(parts) else "")
        info = []
        for col in cols:
            texts = [x for x in col if x.strip()]
            if not texts:
                info.append(None)
                continue
            ind = min(len(x) - len(x.lstrip()) for x in texts)
            info.append((ind, max(len(x) for x in texts) - ind))
        widest = max(i[1] for i in info if i)
        texts = [x.strip() for col in cols for x in col if x.strip()]
        if all(len(x) <= 3 for x in texts):
            continue  # callout numbers on a diagram
        if ncol > 1 and not any(is_prose(col) for ci, col in enumerate(cols)
                                if info[ci] and not (info[ci][1] <= 32 and widest >= 45)):
            # several columns but none of them running text: a grid / diagram
            yield ("table", list(g))
            continue
        for ci, col in enumerate(cols):
            if not info[ci]:
                continue
            ind, width = info[ci]
            # A narrow column next to a full-width one is a sidebar box
            # (DESIGNER'S NOTE / Abathur's TIP / picture captions).
            side = side_strip or (ncol > 1 and width <= 32 and widest >= 45)
            yield ("col", ci, width, side)
            for x in col:
                yield ("line", x[ind:] if x.strip() else "")


def load_pages(path):
    """Split the dump into pages of cleaned lines (running header and page
    numbers removed)."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    pages = []
    for p in raw.split("\f"):
        lines = []
        for l in p.split("\n"):
            l = clean_chars(l.expandtabs()).rstrip()
            if l.strip() == "BACK TO TABLE OF CONTENTS":
                continue
            # one justified line in 12.4 has its last word pushed far right
            l = re.sub(r"(\w) {8,}(to)$", r"\1 \2", l)
            lines.append(l if l.strip() else "")
        # the page number is printed at the bottom, often twice
        while lines and (not lines[-1] or re.fullmatch(r"\s*\d{1,3}", lines[-1])):
            lines.pop()
        while lines and not lines[0]:
            lines.pop(0)
        pages.append(lines)
    return pages


# --------------------------------------------------------------------------
# Titles
# --------------------------------------------------------------------------

SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "into",
               "of", "on", "or", "the", "to", "vs.", "vs", "with", "per"}
ACRONYMS = {"VP", "VPS", "LOS", "CP", "HP", "RoA", "D6", "2D6", "BT", "FT", "TMG"}


def title_case(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", s))
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        if w.upper() in {a.upper() for a in ACRONYMS}:
            out.append(next(a for a in ACRONYMS if a.upper() == w.upper()))
            continue
        lw = w.lower()
        after_colon = i > 0 and out[-1].endswith(":")
        if 0 < i < len(words) - 1 and not after_colon and lw in SMALL_WORDS:
            out.append(lw)
            continue
        # capitalise each hyphen / bracket separated piece: ROLL-OFFS -> Roll-Offs
        out.append(re.sub(r"[A-Za-z’']+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), w))
    t = " ".join(out)
    return re.sub(r"’S\b", "’s", t)


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", s.upper())


# --------------------------------------------------------------------------
# Table of contents
# --------------------------------------------------------------------------

TOC_RE = re.compile(r"^(?:•\s*)?(?:PART (\d+):\s*|(\d+(?:\.\d+)+)\s+)(.*?)(?:[ .]*?\s(\d+))?\s*$")


def parse_toc(pages):
    """Return parts and sections listed in the table of contents, in order."""
    idx = next(i for i, p in enumerate(pages) if any("TABLE OF CONTENTS" in l for l in p))
    raw = "\n".join(pages[idx])
    texts = [e[1] for e in decolumnise(pages[idx]) if e[0] == "line"]
    entries, pending = [], None
    for t in texts:
        t = t.strip()
        if not t:
            continue
        if pending is not None:
            # second line of a wrapped title ("7.2 ENGAGEMENT AND" / "ENGAGEMENT RANGE. . 53")
            m = re.match(r"^(.*?)(?:[ .]*?\s(\d+))?\s*$", t)
            pending["title"] += " " + m.group(1).rstrip(" .")
            pending["page"] = int(m.group(2)) if m.group(2) else None
            entries.append(pending)
            pending = None
            continue
        m = TOC_RE.match(t)
        if not m:
            continue
        part, sid, title, page = m.groups()
        e = {"id": part or sid, "kind": "part" if part else "section",
             "title": title.rstrip(" ."), "page": int(page) if page else None}
        if not re.search(r"\. ?\.|\d\s*$", t):  # no dot leader: title continues on next line
            pending = e
        else:
            entries.append(e)
    for e in entries:
        if e["page"] is None:
            # the page number got cut into the next TOC column: find it in the raw page
            m = re.search(re.escape(e["id"]) + r"\s+" + re.escape(e["title"].split()[0])
                          + r"[^\n]*?[ .]\s*(\d+)\s*(?:\s{3}|$)", raw, re.M)
            e["page"] = int(m.group(1)) if m else None
        e["title"] = re.sub(r"\s+", " ", e["title"].replace("( ", "(").replace(" )", ")"))
    parts = [e for e in entries if e["kind"] == "part"]
    secs = [e for e in entries if e["kind"] == "section"]
    for s in secs:
        s["part"] = s["id"].split(".")[0]
        s["level"] = s["id"].count(".") + 1
    return parts, secs, idx


# --------------------------------------------------------------------------
# Tables (Part 12 points lists)
# --------------------------------------------------------------------------


HEADER_WORDS = {"NAME", "MODELS", "MINERAL", "COST", "SUPPLY", "VALUE", "UPGRADE", "UPGRADES",
                "TYPE", "VESPENE", "GAS", "CREEP", "CARDS"}
RACES = {"TERRAN", "ZERG", "PROTOSS"}


def is_header_word(w):
    return w in HEADER_WORDS or bool(re.fullmatch(r"\(\d+|models?\)", w))


def line_kind(l):
    if not l.strip():
        return None
    words = l.split()
    if all(w in RACES for w in words):
        return "race"
    # (a lone "VALUE" is the second line of a "SUPPLY VALUE" header cell)
    if all(is_header_word(w) for w in words) and (len(words) > 1 or words[0] in ("VALUE", "LIMIT")):
        return "head"
    return "data"


def table_rows(lines):
    """Turn a table laid out with spaces into rows of cells.

    Rows are separated by blank lines; a row may span several text lines when
    a cell wraps ("SPECIALIST, / FOR C-14 Rifle").  Yields (cells, xs).
    """
    blocks, cur, kind = [], [], None
    for l in lines + [""]:
        k = line_kind(l)
        # new row at blank lines and wherever header / data / race labels meet
        if cur and (k is None or k != kind or k == "race"):
            blocks.append(cur)
            cur = []
        if k is not None:
            cur.append(l)
        kind = k
    for b in blocks:
        # A lone ALL-CAPS label inside a multi-cell block ("BASE SYSTEM (§7.1)")
        # is a sub-heading of the table, not part of a cell.
        segs = [len(re.findall(r"\S+(?: \S+)*", l)) for l in b]
        if len(b) > 1 and max(segs) > 1:
            rest = []
            for l, n in zip(b, segs):
                if n == 1 and is_caps_heading(l.strip()) and "§" in l:
                    if rest:
                        yield from block_rows(rest)
                        rest = []
                    yield [l.strip()], [len(l) - len(l.lstrip())]
                else:
                    rest.append(l)
            if rest:
                yield from block_rows(rest)
        else:
            yield from block_rows(b)


def block_rows(b):
    """Rows of one table block (no blank lines inside)."""
    gut = find_gutters(b, min_width=2)
    ncol = len(gut) + 1
    split = [cut_line(l, gut) for l in b]
    full = [i for i, parts in enumerate(split) if sum(1 for p in parts if p.strip()) == ncol]
    if ncol > 1 and len(full) > 1:
        # several rows printed without blank lines between them: wrapped
        # cell lines belong to the nearest complete line
        owner = [min(full, key=lambda f: (abs(f - i), f)) for i in range(len(b))]
        groups = [[split[i] for i in range(len(b)) if owner[i] == f] for f in full]
    else:
        groups = [split]
    for g in groups:
        cells, xs = [], []
        for ci in range(ncol):
            txt = " ".join(p[ci].strip() for p in g if ci < len(p) and p[ci].strip())
            if txt:
                cells.append(re.sub(r"\s+", " ", txt))
                # where the cell's text starts on the page
                xs.append(min(sum(len(q) for q in p[:ci]) + len(p[ci]) - len(p[ci].lstrip())
                              for p in g if ci < len(p) and p[ci].strip()))
        if cells:
            yield cells, xs


def table_events(lines):
    """Rows of a table page.  Side-by-side tables (12.11 has Terran and Zerg
    next to each other) are split at the second race label and the right-hand
    table is emitted after the left one."""
    split_x, right = None, []
    for cells, xs in table_rows(lines):
        if len(cells) >= 2 and all(c in RACES for c in cells):
            split_x = xs[1] - 2
            yield ("row", [cells[0]])
            right.append([cells[1]])
            continue
        if len(cells) == 1 and cells[0] in RACES and split_x is not None:
            for r in right:
                yield ("row", r)
            split_x, right = None, []
        if split_x is None:
            yield ("row", cells)
            continue
        left = [c for c, x in zip(cells, xs) if x < split_x]
        rgt = [c for c, x in zip(cells, xs) if x >= split_x]
        if left:
            yield ("row", left)
        if rgt:
            right.append(rgt)
    for r in right:
        yield ("row", r)


# --------------------------------------------------------------------------
# Page stream
# --------------------------------------------------------------------------


# Titles that open a reference table (LoS / Cover / Mission Markers / ability
# summary / 12.8).  The table runs until the next numbered heading.
TABLE_TITLE_RE = re.compile(r"\bTABLE:?$|^MISSION MARKER - |^COVER TYPE\s+CONDITION|^12\.8 TEMPLATE WEAPONS$")
HEADING_START_RE = re.compile(r"^\s*(\d+(\.\d+)+ [A-Z]|PART \d+:)")


def squash(l):
    return re.sub(r"\s+", " ", l).strip()


def page_events(pages, first, last, table_from):
    """Yield the body in reading order as events:
       ("page", n) / ("col", index, width, is_sidebar) / ("line", text) / ("row", cells)
    Pages from book page `table_from` on are tables (Part 12.10-12.12); other
    tables are found by their titles and may continue onto the next page
    (recognised by a repeated header row)."""
    carry = None  # header row of a table that ran off the previous page
    for pi in range(first, last):
        book = pi + 1 - PAGE_OFFSET
        lines = pages[pi]
        yield ("page", book)
        if book >= table_from:
            yield ("col", 0, 100, False)
            yield from table_events(lines)
            continue
        nonblank = [i for i, l in enumerate(lines) if l.strip()]
        start = None
        if carry and nonblank and squash(lines[nonblank[0]]) == carry:
            start = nonblank[0]
        else:
            start = next((i for i in nonblank if TABLE_TITLE_RE.search(lines[i].strip())
                          and not re.search(r"\S {3,}\S", lines[i].strip())
                          or lines[i].strip().startswith("COVER TYPE")), None)
        carry = None
        if start is None:
            yield from grid_aware(decolumnise(lines))
            continue
        end = next((i for i in nonblank if i > start and HEADING_START_RE.match(lines[i])), len(lines))
        yield from grid_aware(decolumnise(lines[:start]))
        yield ("col", 0, 100, False)
        yield from table_events(lines[start:end])
        if end < len(lines):
            yield from grid_aware(decolumnise(lines[end:]))
        else:
            carry = next((squash(l) for l in lines[start + 1:end] if re.search(r"\S {3,}\S", l.strip())), None)


def grid_aware(events):
    """Turn ("table", lines) groups from decolumnise into table rows."""
    for e in events:
        if e[0] == "table":
            yield ("col", 0, 100, False)
            yield from table_events(e[1])
        else:
            yield e


# --------------------------------------------------------------------------
# Reflow
# --------------------------------------------------------------------------

BULLET_RE = re.compile(r"^(?:X|•)\s+(?=[A-Z0-9“\"(‘'+\[-])")
NOTE_RE = re.compile(r"^(DESIGNER’S NOTE|Abathur’s TIP|NOTE:|Note:|IMPORTANT:|EXAMPLE\b)")
ENDS_RE = re.compile(r"[.!?:;][”’\")]*$|[.!?]\)$")
KEEP_HYPHEN_PREFIXES = {"non", "anti", "self", "semi", "multi", "pre", "re", "co", "cross",
                        "high", "low", "close", "long", "short", "well", "base", "same",
                        "half", "one", "two", "three", "four", "six", "post", "sub"}


def is_caps_heading(s):
    """ALL CAPS line usable as a sub-heading (ignoring [Characteristic] / (Unit Name))."""
    core = re.sub(r"\[[^\]]*\]|\([^)]*\)", "", s)
    letters = re.sub(r"[^A-Za-z]", "", core)
    return (len(letters) >= 3 and letters.isupper() and len(s) <= 70
            and not s.endswith(",") and not re.fullmatch(r"[\d\s.,–-]+", s))


class Vocabulary:
    """Words seen in the book, used to undo end-of-line hyphenation."""

    def __init__(self, text):
        words = re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*", text)
        self.plain = {w.lower() for w in words if "-" not in w}
        self.hyph = set()
        for line in text.split("\n"):
            for w in re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)+(?=\W)", line):
                self.hyph.add(w.lower())

    def join(self, left, right):
        """Join `left` (ending in '-') with `right`."""
        a = re.search(r"([A-Za-z]+)-$", left)
        b = re.match(r"([A-Za-z]+)", right)
        if not a or not b:
            return left + right
        w1, w2 = a.group(1), b.group(1)
        # This book almost never splits words across lines, so a line-end
        # hyphen is kept ("top-right", "catch-up") unless the joined word is
        # a word used elsewhere in the book ("move-ment" -> "movement").
        if w2[0].isupper() or (w1 + "-" + w2).lower() in self.hyph:
            return left + right
        if (w1 + w2).lower() in self.plain and w1.lower() not in KEEP_HYPHEN_PREFIXES:
            return left[:-1] + right
        return left + right


class Builder:
    def __init__(self, parts, toc, vocab):
        self.parts = {p["id"]: p for p in parts}
        self.toc = toc
        self.vocab = vocab
        self.sections = []
        self.sec = None
        self.cur = None          # open block: dict(t, text, ind)
        self.pending = []        # sidebar notes waiting for the open paragraph
        self.prev_len = 0        # length of the previous text line
        self.width = 60
        self.soft = False        # a column / page break since the last line
        self.page = None
        self.next_toc = 0
        self.blank = False
        self.side_note = None    # last sidebar box, may continue in a later block

    # -- sections ---------------------------------------------------------
    def start_section(self, sid, level, title, page, part):
        self.flush()
        self.sec = {"id": sid, "part": part, "level": level, "title": title_case(title),
                    "page": page, "blocks": []}
        self.sections.append(self.sec)

    def add(self, block):
        if self.sec is None:
            return  # text before Part 1 (front matter)
        block["text"] = re.sub(r"\s+", " ", block["text"]).strip()
        block["text"] = re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", block["text"]))
        if block["text"]:
            block["_page"] = self.page  # used for glossary refs, dropped on output
            self.sec["blocks"].append(block)

    def flush(self):
        if self.cur:
            self.add({"t": self.cur["t"], "text": self.cur["text"]})
            self.cur = None
        for b in self.pending:
            self.add(b)
        self.pending = []

    def append_text(self, s):
        t = self.cur["text"]
        if re.search(r"[A-Za-z]-$", t):
            self.cur["text"] = self.vocab.join(t, s)
        else:
            self.cur["text"] = t + " " + s

    # -- headings ---------------------------------------------------------
    def match_heading(self, lines, i):
        """If lines[i] is the next TOC heading, return (entry, lines consumed)."""
        s = lines[i].strip()
        m = re.match(r"^PART (\d+):\s*(.*)$", s)
        if m and m.group(1) in self.parts and m.group(1) not in self.seen_parts:
            e = self.parts[m.group(1)]
            acc, j = m.group(2), i + 1
            while norm(acc) != norm(e["title"]) and j < len(lines):
                nxt = lines[j].strip()
                if not nxt:
                    j += 1
                    continue
                if norm(e["title"]).startswith(norm(acc + nxt)):
                    acc += " " + nxt
                    j += 1
                else:
                    break
            return ("part", e, None), j - i
        m = re.match(r"^(\d+(?:\.\d+)+)\s+(.+)$", s)
        if m:
            # look a few entries ahead so one missed heading does not stall us
            for k in range(self.next_toc, min(self.next_toc + 4, len(self.toc))):
                e = self.toc[k]
                if e["id"] != m.group(1):
                    continue
                acc = m.group(2)
                nt, na = norm(e["title"]), norm(acc)
                if len(na) < 3 or not (nt.startswith(na) or na.startswith(nt)):
                    return None
                j = i + 1
                while norm(acc) != norm(e["title"]) and j < len(lines):
                    nxt = lines[j].strip()
                    if nxt and norm(e["title"]).startswith(norm(acc + nxt)):
                        acc += " " + nxt
                        j += 1
                    else:
                        break
                return ("sec", e, k), j - i
        return None

    # -- main text --------------------------------------------------------
    def text_line(self, line, lines, i):
        s = line.strip()
        ind = len(line) - len(line.lstrip())
        if not s or re.fullmatch(r"(\d{1,2}\s+)*(\d{1,2}|Unit Card (obverse|reverse))", s):
            # blank, or a callout number / label of the Unit Card diagrams
            self.blank = True
            return 1
        soft, self.soft = self.soft, False
        blank, self.blank = self.blank, False
        rest = [l.strip() for l in lines[i + 1:] if l.strip()]
        if blank and self.cur and self.cur["t"] in ("p", "li") and is_caps_heading(s) \
                and not ENDS_RE.search(self.cur["text"]) and not self.match_heading(lines, i) \
                and (not rest or rest[0][0].islower()):
            # a picture title dropped into the middle of a sentence: keep the
            # sentence open and show the title after it
            self.pending.append({"t": "h", "text": s})
            self.blank = True
            return 1
        if blank and self.cur:
            # A gap inside a column ends the paragraph, unless the sentence
            # obviously continues: next line in lower case, or an unfinished
            # sentence followed by a line that does not open a new block
            # (rows of a table or a picture beside the text leave such gaps).
            cont = s[0].islower() or s[0] == "(" or (
                self.cur["t"] == "li" and ind >= self.cur["ind"] - 1 and not BULLET_RE.match(s)) or (
                self.cur["t"] in ("p", "note") and not BULLET_RE.match(s) and not NOTE_RE.match(s)
                and not is_caps_heading(s) and not re.match(r"^\d{1,2}\.\s", s)
                and not self.match_heading(lines, i))
            hanging = (self.cur["t"] == "li" and ind >= max(1, self.cur["ind"] - 1)
                       and not BULLET_RE.match(s))  # indented: still the same item
            if not hanging and (ENDS_RE.search(self.cur["text"]) or not cont):
                self.flush()
        h = self.match_heading(lines, i)
        if h:
            kind, e, k = h[0]
            if k is not None:
                self.next_toc = k + 1
            if kind == "part":
                self.seen_parts.add(e["id"])
                self.start_section(e["id"], 1, e["title"], self.page, e["id"])
            else:
                self.start_section(e["id"], e["level"], e["title"], self.page, e["part"])
            self.prev_len = 0
            return h[1]
        cur = self.cur
        ended = cur is None or bool(ENDS_RE.search(cur["text"]))
        short = self.prev_len < 0.72 * self.width
        self.prev_len = len(s)
        if BULLET_RE.match(s):
            self.flush()
            self.cur = {"t": "li", "text": BULLET_RE.sub("", s), "ind": ind + 2}
            return 1
        if NOTE_RE.match(s) and (ended or short):
            self.flush()
            self.cur = {"t": "note", "text": s, "ind": ind}
            return 1
        if is_caps_heading(s) and (cur is None or ended or cur["t"] == "h"):
            # consecutive caps lines form one heading
            if cur and cur["t"] == "h" and not soft and not blank:
                cur["text"] += " " + s
            else:
                self.flush()
                self.cur = {"t": "h", "text": s, "ind": ind}
            return 1
        if re.match(r"^\d{1,2}\.\s+\S", s) and (ended or short):
            self.flush()
            self.cur = {"t": "li", "text": s, "ind": ind + 3}
            return 1
        if cur is None or cur["t"] == "h":
            self.flush()
            self.cur = {"t": "p", "text": s, "ind": ind}
            return 1
        if soft and ended:
            self.flush()
            self.cur = {"t": "p", "text": s, "ind": ind}
            return 1
        if cur["t"] == "li":
            # a non-indented line after a finished item starts a paragraph
            if ended and ind < cur["ind"] - 1 and not soft:
                self.flush()
                self.cur = {"t": "p", "text": s, "ind": ind}
                return 1
            self.append_text(s)
            return 1
        leadin = re.match(r"^[A-Z][A-Z’'\- ]{3,}[.:]\s", s)
        if ended and (short or leadin):
            self.flush()
            self.cur = {"t": "p", "text": s, "ind": ind}
            return 1
        self.append_text(s)
        return 1

    # -- sidebars ---------------------------------------------------------
    def sidebar(self, lines):
        """A sidebar column: group paragraphs into note boxes."""
        paras, cur = [], []
        for l in lines + [""]:
            if l.strip():
                cur.append(l.strip())
            elif cur:
                paras.append(cur)
                cur = []
        for p in paras:
            text = ""
            for l in p:
                if re.search(r"[A-Za-z]-$", text):
                    text = self.vocab.join(text, l)
                else:
                    text = (text + " " + l).strip()
            text = re.sub(r"\s+", " ", text)
            open_note = self.side_note
            if open_note and not NOTE_RE.match(text) and not text.startswith("In this example"):
                # continuation of the box (its title can sit in an earlier
                # block; picture captions start "In this example")
                open_note["text"] += " " + text
                continue
            if re.fullmatch(r"Abathur’s TIP", text):
                text += ":"
            # in the Part 1 battle report the narrow columns are part of the
            # story (text beside the pictures), not boxed notes
            story = self.sec is not None and self.sec["part"] == "1" and not NOTE_RE.match(text)
            block = {"t": "p" if story else "note", "text": text}
            self.side_note = block
            if self.cur and not ENDS_RE.search(self.cur["text"]):
                self.pending.append(block)  # don't split an open paragraph
            else:
                self.flush()
                self.add(block)

    # -- tables -----------------------------------------------------------
    def row(self, cells):
        if len(cells) == 1:
            # single-cell rows are headings (race, unit name) or TOC headings
            if self.match_heading(cells, 0) is not None:
                return self.text_line(cells[0], cells, 0)
            self.flush()
            c = cells[0]
            if NOTE_RE.match(c):
                self.add({"t": "note", "text": c})
            elif TABLE_TITLE_RE.search(c):
                self.add({"t": "h", "text": c})
            elif is_caps_heading(c):
                self.add({"t": "h", "text": title_case(c) if c.isupper() else c})
            else:
                self.add({"t": "p", "text": c})
            return
        self.flush()
        head = all(all(is_header_word(w) for w in c.split()) for c in cells)
        cells = [re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", c)) for c in cells]
        if head:
            cells = [title_case(c) for c in cells]
        b = {"t": "p", "text": " · ".join(cells), "cells": cells}
        if head:
            b["head"] = True
        self.add(b)

    # -- driver -----------------------------------------------------------
    def run(self, events):
        self.seen_parts = set()
        events = list(events)
        i = 0
        while i < len(events):
            ev = events[i]
            if ev[0] == "page":
                self.page = ev[1]
                self.side_note = None
                self.soft = True
                i += 1
            elif ev[0] == "row":
                self.row(ev[1])
                i += 1
            elif ev[0] == "col":
                _, ci, width, side = ev
                j = i + 1
                while j < len(events) and events[j][0] == "line":
                    j += 1
                lines = [e[1] for e in events[i + 1:j]]
                if side:
                    self.sidebar(lines)
                else:
                    self.width = max(width, 30)
                    self.soft = True
                    self.blank = False
                    while lines and not lines[0].strip():
                        lines.pop(0)
                    k = 0
                    while k < len(lines):
                        k += self.text_line(lines[k], lines, k)
                i = j
            else:
                i += 1
        self.flush()
        return self.sections


# --------------------------------------------------------------------------
# TSV sources
# --------------------------------------------------------------------------


def read_tsv(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return [[c.strip() for c in r] for r in csv.reader(f, delimiter="\t") if any(c.strip() for c in r)]


def tidy(s):
    return re.sub(r"\s+", " ", clean_chars(s)).strip()


def load_glossary(src, sections):
    out, seen = [], set()
    for r in read_tsv(os.path.join(src, "glossary.tsv")):
        r += [""] * (3 - len(r))
        if r[0] and r[1]:
            out.append({"term": tidy(r[0]), "text": tidy(r[1]), "ref": tidy(r[2])})
            seen.add(norm(r[0]))
    # Part 11 of the book is the keyword glossary: add any term the TSV lacks.
    part11 = next((s for s in sections if s["id"] == "11"), None)
    if part11:
        term, text = None, []
        for b in part11["blocks"] + [{"t": "h", "text": ""}]:
            if b["t"] == "h":
                if term and text and norm(term) not in seen:
                    out.append({"term": term, "text": " ".join(text),
                                "ref": "Core Rules Part 11 · p. %d" % page})
                    seen.add(norm(term))
                term, text, page = b["text"], [], b.get("_page", part11["page"])
            elif term:
                text.append(("• " if b["t"] == "li" else "") + b["text"])
    # Rule terms that have their own section ("Roll-Offs", "Charge", "Cover",
    # "Tactical Mass" ...) get an entry too: the section's opening paragraph,
    # pointing back to the section.  Titles used by several sections
    # ("Activations", "Passing", "Hold") are too ambiguous to be a term.
    # Only titles that name a single concept: no "X and Y", no "How ...",
    # "Determine ...", no Quick Reference duplicates.
    titles = [s["title"].upper() for s in sections]
    not_a_term = re.compile(r"\bAND\b|&|\bVS\b|[:(]|^(THE |HOW |DETERMIN|RESOLV|SELECT|PURCHAS|MUSTER|"
                            r"MANAGING|MEASURING|SCORE |REMOVING |PASSING|ACTIVATIONS|HOLD$)")
    seen |= {norm(re.sub(r"\(.*?\)", "", g["term"])) for g in out}
    for s in sections:
        t = s["title"].upper()
        if s["level"] == 1 or s["part"] == "12" or titles.count(t) > 1 or norm(t) in seen \
                or not_a_term.search(t):
            continue
        first = next((b for b in s["blocks"] if b["t"] in ("p", "li") and "cells" not in b), None)
        if not first or len(first["text"]) < 40:
            continue
        out.append({"term": t, "text": first["text"],
                    "ref": "Core Rules Part %s · p. %d" % (s["id"], s["page"]), "section": s["id"]})
        seen.add(norm(t))
    return out


def load_faq(src):
    faq = []
    for r in read_tsv(os.path.join(src, "faq_qa.tsv")):
        if len(r) >= 2 and r[0] and r[1]:
            faq.append({"q": tidy(r[0]), "a": tidy(r[1])})
    return faq


COST_RE = r"(?P<cost>[0-9X]+\s*(?:CP|BM|PE))"


def load_abilities(src):
    out = []
    for r in read_tsv(os.path.join(src, "abilities.tsv")):
        r += [""] * (5 - len(r))
        faction, name, typ, text, ref = (tidy(x) for x in r[:5])
        if not text:
            continue
        a = {"faction": faction.upper(), "name": title_case(name), "type": typ.title(), "text": text, "ref": ref}
        # Text usually repeats the card header: "STIMPACK: ACTIVE 1 CP This Unit ..."
        # (sometimes after a few stray characters from the weapon table).
        m = re.match(r"^.{0,10}?" + re.escape(name) + r"\s*:\s*" + re.escape(typ) + r"\b\s*(?:"
                     + COST_RE + r"\b)?\s*", text, re.I)
        if m:
            a["text"] = text[m.end():]
            if m.group("cost"):
                a["cost"] = re.sub(r"\s+", " ", m.group("cost"))
        else:
            m = re.match(r"^" + COST_RE + r"\b\s*", text)
            if m:
                a["text"], a["cost"] = text[m.end():], m.group("cost")
        out.append(a)
    return out


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", default=DEFAULT_SRC, help="folder with core_rules.txt and the TSVs")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output JSON file")
    ap.add_argument("--debug", help="also write the de-columnised page text here")
    args = ap.parse_args()

    core = os.path.join(args.src, "core_rules.txt")
    pages = load_pages(core)
    parts, toc, toc_idx = parse_toc(pages)

    if args.debug:
        with open(args.debug, "w", encoding="utf-8") as f:
            for i, p in enumerate(pages):
                f.write("\n######## PDF %d / book %d\n" % (i + 1, i + 1 - PAGE_OFFSET))
                for e in decolumnise(p):
                    if e[0] == "line":
                        f.write("|%s\n" % e[1])
                    elif e[0] == "col":
                        f.write("== col %d w%d side=%s\n" % e[1:])
                    else:
                        f.write("== grid\n" + "\n".join(e[1]) + "\n")

    # body: from the "PART 1:" page to the page before the index
    first = next(i for i in range(toc_idx + 1, len(pages)) if any(re.match(r"\s*PART 1:(\s|$)", l) for l in pages[i]))
    last = next(i for i in range(first, len(pages)) if pages[i] and pages[i][0].lstrip().startswith("INDEX"))
    table_from = next(e["page"] for e in toc if e["id"] == "12.10") + 1

    with open(core, encoding="utf-8") as f:
        vocab = Vocabulary(f.read())
    b = Builder(parts, toc, vocab)
    sections = b.run(page_events(pages, first, last, table_from))

    # A wrapped heading tail that reached the text: "(FULL RULES) Active ..."
    for s in sections:
        m = re.search(r"\([^)]*\)$", s["title"])
        if m and s["blocks"] and s["blocks"][0]["text"].upper().startswith(m.group(0).upper()):
            s["blocks"][0]["text"] = s["blocks"][0]["text"][len(m.group(0)):].strip()
    # Every TOC entry gets a section, even if its heading was not found.
    have = {s["id"] for s in sections}
    for e in toc:
        if e["id"] not in have:
            print("warning: heading %s %s not found in body" % (e["id"], e["title"]), file=sys.stderr)

    glossary = load_glossary(args.src, sections)
    for s in sections:
        for b in s["blocks"]:
            b.pop("_page", None)
    data = {
        "parts": [{"id": p["id"], "title": title_case(p["title"]), "page": p["page"]} for p in parts],
        "sections": sections,
        "glossary": glossary,
        "faq": load_faq(args.src),
        "abilities": load_abilities(args.src),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("parts %d, sections %d, glossary %d, faq %d, abilities %d -> %s (%d bytes)" % (
        len(data["parts"]), len(sections), len(data["glossary"]), len(data["faq"]),
        len(data["abilities"]), os.path.relpath(args.out), os.path.getsize(args.out)))


if __name__ == "__main__":
    main()
