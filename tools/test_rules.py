#!/usr/bin/env python3
"""Sanity checks for site/data/rules.json (run after tools/build_rules.py).

Usage: python3 tools/test_rules.py [path/to/rules.json]
"""

import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RULES = os.path.join(HERE, "..", "site", "data", "rules.json")
SRC = "/Users/talhorowitzhorine/Liad/SC-TMG-Companion/app/src/main/assets/rules"

sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # importing build_rules must not leave __pycache__ behind


def toc_ids():
    """Section ids listed in the book's table of contents."""
    import build_rules
    pages = build_rules.load_pages(os.path.join(SRC, "core_rules.txt"))
    parts, secs, _ = build_rules.parse_toc(pages)
    return [p["id"] for p in parts], [s["id"] for s in secs]


class RulesJsonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(RULES, encoding="utf-8") as f:
            cls.data = json.load(f)
        cls.sections = {s["id"]: s for s in cls.data["sections"]}

    def test_top_level_keys(self):
        for key in ("parts", "sections", "glossary", "faq", "abilities"):
            self.assertIn(key, self.data)

    def test_every_toc_section_present(self):
        if not os.path.exists(os.path.join(SRC, "core_rules.txt")):
            self.skipTest("rulebook source not available")
        part_ids, sec_ids = toc_ids()
        self.assertGreater(len(sec_ids), 100)
        for sid in part_ids + sec_ids:
            self.assertIn(sid, self.sections, "TOC entry %s missing" % sid)

    def test_no_column_gaps_in_text(self):
        for s in self.data["sections"]:
            for b in s["blocks"]:
                self.assertNotRegex(b["text"], r" {6,}", "wide gap in %s: %r" % (s["id"], b["text"][:80]))

    def test_ranged_attack_resolution_mentions_evade(self):
        text = " ".join(b["text"] for b in self.sections["8.7.4"]["blocks"])
        self.assertIn("Evade", text)

    def test_glossary_size(self):
        self.assertGreater(len(self.data["glossary"]), 100)
        for g in self.data["glossary"]:
            self.assertTrue(g["term"] and g["text"])

    def test_faq_size(self):
        self.assertGreater(len(self.data["faq"]), 20)
        for q in self.data["faq"]:
            self.assertTrue(q["q"] and q["a"])

    def test_sections_have_blocks(self):
        secs = self.data["sections"]
        filled = sum(1 for s in secs if s["blocks"])
        self.assertGreaterEqual(filled / len(secs), 0.95)

    def test_section_shape(self):
        for s in self.data["sections"]:
            self.assertEqual(s["level"], s["id"].count(".") + 1)
            self.assertEqual(s["part"], s["id"].split(".")[0])
            for b in s["blocks"]:
                self.assertIn(b["t"], ("p", "li", "h", "note"))
                self.assertTrue(b["text"].strip())

    def test_abilities(self):
        self.assertGreater(len(self.data["abilities"]), 100)
        for a in self.data["abilities"]:
            self.assertTrue(a["name"] and a["text"])
            # the "NAME: TYPE" card header is stripped from the text
            self.assertFalse(re.match(re.escape(a["name"]) + r"\s*:", a["text"], re.I), a["name"])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].endswith(".json"):
        RULES = sys.argv.pop(1)
    unittest.main()
