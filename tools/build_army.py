#!/usr/bin/env python3
"""Merge the standalone StarCraft TMG Army Builder into TMG Command.

Inputs : the builder's single HTML file (default ~/Downloads/starcraft-tmg-army-builder.html)
Outputs: site/army/index.html  - the builder, dark-themed, offline-safe, with a bridge to the app
         site/data/army.json   - its DATA (units, cards, stats) + voiceId for each unit (the entry in
                                 media.json whose voice lines the unit uses), for unit cards and rosters.
Usage  : python3 tools/build_army.py [path/to/starcraft-tmg-army-builder.html]
"""
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads/starcraft-tmg-army-builder.html"

# Builder unit id -> media.json unit id (whose voice lines the unit uses), where the ids differ.
ALIASES = {
    "raynors-raider": "marine", "spec-ops-marauder": "marauder", "nova-stealth": "nova", "nova-assault": "nova",
    "raptor": "zergling", "swarmling": "zergling", "kerrigan-swarm-raptor": "zergling", "vileling": "zergling",
    "vile": "roach", "corpser": "roach", "bile-launcher": "ravager",
    "praetor-guard": "zealot", "nerazim-watchers": "adept", "twilight-templar": "high_templar",
}

THEME_CSS = """
<style id="companion-theme">
/* App skin: dark palette and system fonts, so the page matches the app and works offline. */
:root[data-theme="dark"] {
  --bg: #070B12; --surface: #0E1622; --surface-2: #162233; --ink: #E9F1F8; --muted: #8C9DB0; --line: #22344A;
  --accent: #4FB8FF; --terran: #4FA3E8; --zerg: #B36AE2; --protoss: #E7B84B; --good: #72D59C; --warn: #FFA64A; --bad: #E86A6A;
  --up: #77C7FF; --up-bg: #0B2438;
  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}
.bar { top: 0; box-shadow: 0 1px 0 rgba(119,199,255,.25); }
/* Shown inside the app, which already handles the notch: drop the builder's own safe-area gaps. */
:root { padding-top: 0 !important; padding-bottom: 0 !important; }
html { scroll-padding-top: 0 !important; }
.bar-in { padding-top: 8px !important; padding-bottom: 8px !important; }
.panel { border-color: rgba(119,199,255,.28) !important; }
body::before { display: none; }
input, select { font-size: 16px !important; } /* stops iOS zooming into fields */
</style>
"""

# The builder is one self-contained page with inline script and styles; it loads nothing from the network.
BUILDER_CSP = ('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; '
               'style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; object-src \'none\'; '
               'base-uri \'self\'; form-action \'none\'">')

BRIDGE_JS = """
<script>
/* Bridge: tell the parent app when saved lists change, and let it open a faction. */
(function () {
  var inFrame = window.parent && window.parent !== window;
  var setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    setItem.apply(this, arguments);
    if (inFrame && (k === 'sctmg-saved' || k === 'sctmg-builder')) { try { window.parent.postMessage({ type: 'army:changed' }, location.origin); } catch (e) {} }
  };
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'army:faction') {
      var f = String(e.data.faction);
      if (!/^(terran|zerg|protoss)$/.test(f)) return;
      var b = document.querySelector('#facSeg [data-f="' + f + '"]');
      if (b) b.click();
    }
  });
})();
</script>
"""


def main():
    html = SRC.read_text(encoding="utf8")
    lines = html.split("\n")
    data_line = next(l for l in lines if l.startswith("var DATA = "))
    data = json.loads(data_line[len("var DATA = "):].strip().rstrip(";"))

    media = BASE / "site/data/media.json"  # written by build_media.py; without it units get no voices
    cids = set(json.loads(media.read_text())["units"]) if media.exists() else set()
    missing = []
    for fac in data.values():
        for u in fac["units"]:
            cid = ALIASES.get(u["id"], u["id"].replace("-", "_"))
            u["voiceId"] = cid if cid in cids else None
            if not u["voiceId"]:
                missing.append(u["id"])
    out_data = BASE / "site/data/army.json"
    out_data.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf8")

    # Builder page: dark theme by default, no Google Fonts (offline), app skin + bridge.
    page = html.replace("<html>", '<html data-theme="dark">', 1)
    page = re.sub(r'<link rel="preconnect"[^>]*>\n?', "", page)
    page = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\n?', "", page)
    page = page.replace("color-scheme:light;", "color-scheme:dark;", 1)
    page = page.replace("background:#fff;color:#000", "background:#070B12;color:#E9F1F8", 1)
    page = page.replace("<head>", "<head>" + BUILDER_CSP, 1)
    page = page.replace("</head>", THEME_CSS + "</head>", 1)  # first </head> is the page's own
    # Only the real closing tag (the print template inside the script also contains "</body></html>").
    cut = page.rindex("</body></html>")
    page = page[:cut] + BRIDGE_JS + page[cut:]
    out_page = BASE / "site/army/index.html"
    out_page.parent.mkdir(parents=True, exist_ok=True)
    out_page.write_text(page, encoding="utf8")

    n = sum(len(f["units"]) for f in data.values())
    print(f"army.json: {n} units, {len(missing)} without voice lines {missing}")
    print(f"wrote {out_page.relative_to(BASE)} ({out_page.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
