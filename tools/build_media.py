#!/usr/bin/env python3
"""Convert the SC TMG Companion app's media into a web-friendly set, plus a manifest.

Reads (read-only) the Android app's asset folders - audio and images only, never its code -
and writes:
  site/media/<path>   audio -> .m4a (AAC: plays on iOS Safari, Android Chrome and desktop),
                      images -> .webp
  site/data/media.json  what the app can play or show: unit and building voices by faction,
                        announcer lines, match intro and result lines, music, rules images.

Re-encodes a file only when its output is
missing or older than the source, and deletes outputs that are no longer selected.

Usage: python3 tools/build_media.py [--src DIR] [--seed DIR] [--jobs N] [--dry-run]
  --src   the Android app's assets folder (default ../SC-TMG-Companion/app/src/main/assets)
  --seed  an earlier output folder with the same layout to copy converted files from
Requires ffmpeg and cwebp on PATH.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
OUT_MEDIA = BASE / "site/media"
OUT_DATA = BASE / "site/data/media.json"
DEFAULT_SRC = BASE.parent / "SC-TMG-Companion/app/src/main/assets"

AUDIO_EXT = {".ogg", ".wav", ".mp3", ".m4a"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
VOICE_KINDS = {"deploy_move": "move", "attack": "attack", "death": "death", "chatter": "chatter"}

# Faction for each voiced unit or hero. Most come from the clip's original game path
# (TerranUnitVO, ProtossVO, ...); these are the ones whose path doesn't say, or says wrongly.
FACTION_OVERRIDES = {
    "widow_mine": "terran", "warhound": "terran", "warbot": "terran", "matt_horner": "terran",
    "liberator": "terran", "mengsk": "terran", "rohana": "protoss", "reaver": "protoss",
    "shield_battery": "protoss", "disruptor": "protoss", "phoenix": "protoss", "dragoon": "protoss",
    "stukov": "zerg", "ravager": "zerg", "swarm_host": "zerg", "viper": "zerg", "defiler": "zerg",
    "devourer": "zerg", "aberration": "zerg", "brutalisk": "zerg", "leviathan": "zerg",
    "abathur": "zerg", "dehaka": "zerg", "guardian": "zerg",
}
# Names that plain title-casing gets wrong.
NAME_OVERRIDES = {
    "scv": "SCV", "hellbat": "Hellbat", "jim_raynor": "Jim Raynor", "sarah_kerrigan": "Sarah Kerrigan",
    "thor": "Thor", "mule": "MULE", "dark_templar": "Dark Templar", "high_templar": "High Templar",
}
BUILDING_FACTION = {
    "terran": {"academy", "armory", "barracks", "bunker", "command_center", "engineering_bay", "factory",
               "ghost_academy", "missile_turret", "orbital_command", "planetary_fortress", "refinery",
               "sensor_tower", "starport", "supply_depot", "tech_lab", "reactor", "fusion_core"},
    "zerg": {"baneling_nest", "evolution_chamber", "extractor", "hatchery", "hive", "hydralisk_den", "infestation_pit",
             "lair", "nydus_network", "nydus_worm", "roach_warren", "spawning_pool", "spine_crawler", "spire",
             "spore_crawler", "ultralisk_cavern", "creep_tumor", "greater_spire", "omega_worm", "lurker_den"},
    "protoss": {"assimilator", "cybernetics_core", "dark_shrine", "fleet_beacon", "forge", "gateway", "nexus",
                "photon_cannon", "pylon", "robotics_bay", "robotics_facility", "stargate", "templar_archives",
                "twilight_council", "warp_gate", "shield_battery", "stasis_ward"},
}


def title(slug: str) -> str:
    return NAME_OVERRIDES.get(slug) or " ".join(w.capitalize() for w in slug.split("_"))


def track_title(stem: str) -> str:
    stem = re.sub(r"__[0-9a-f]{6,}$", "", stem)          # dedupe hash suffix
    stem = re.sub(r"[_]+", " ", stem)
    stem = re.sub(r"(?<=[a-z])(?=[A-Z0-9])", " ", stem)   # CamelCase -> words
    return re.sub(r"\s+", " ", stem).strip()


def out_rel(rel: str) -> str:
    p = Path(rel)
    ext = ".m4a" if p.suffix.lower() in AUDIO_EXT else ".webp"
    return str(p.with_suffix(ext))


class Media:
    """Collects the selected source files and the manifest that points at their outputs."""

    def __init__(self, src: Path):
        self.src = src
        self.files: dict[str, str] = {}   # output rel -> kind ("voice" | "music" | "image")

    def add(self, rel: str, kind: str) -> str | None:
        if not (self.src / rel).is_file():
            return None
        o = out_rel(rel)
        self.files[o] = (rel, kind)
        return o

    def folder(self, rel: str, kind: str = "voice") -> list[str]:
        d = self.src / rel
        if not d.is_dir():
            return []
        exts = AUDIO_EXT if kind != "image" else IMAGE_EXT
        names = sorted(p.name for p in d.iterdir() if p.is_file() and p.suffix.lower() in exts)
        return [o for o in (self.add(f"{rel}/{n}", kind) for n in names) if o]


def unit_factions(src: Path) -> dict[str, str]:
    """Faction per unit id, from the original game path recorded in audio_manifest.csv."""
    votes: dict[str, dict[str, int]] = {}
    with open(src / "audio_manifest.csv", newline="", encoding="utf8") as f:
        for r in csv.DictReader(f):
            m = re.search(r"(Terran|Protoss|Zerg)", r["source"])
            if m:
                v = votes.setdefault(r["id"], {})
                v[m.group(1).lower()] = v.get(m.group(1).lower(), 0) + 1
    out = {k: max(v, key=v.get) for k, v in votes.items()}
    out.update(FACTION_OVERRIDES)
    return out


def canonical_roles(src: Path) -> dict[str, str]:
    """Extra unit clips in 'canonical' folders, with their role (move / attack / death)."""
    roles = {}
    p = src / "audio/audio_runtime_roles.csv"
    if p.exists():
        with open(p, newline="", encoding="utf8") as f:
            for r in csv.DictReader(f):
                role = r["roles"].split("|")[0].split(";")[0].strip()
                roles[r["asset_path"]] = {"deploy_move": "move", "ready": "move"}.get(role, role)
    return roles


def labels(src: Path) -> dict[str, str]:
    """Spoken text for clips that have it (shown under the soundboard button)."""
    out = {}
    p = src / "audio/audio_display_labels.csv"
    if p.exists():
        with open(p, newline="", encoding="utf8") as f:
            for r in csv.DictReader(f):
                if r.get("display_label"):
                    out[out_rel(r["asset_path"])] = r["display_label"]
    return out


def collect(src: Path) -> tuple[Media, dict]:
    m = Media(src)
    factions = unit_factions(src)
    roles = canonical_roles(src)
    units = {}
    for d in sorted((src / "audio/units").iterdir()):
        if not d.is_dir():
            continue
        voices = {}
        for folder, kind in VOICE_KINDS.items():
            clips = m.folder(f"audio/units/{d.name}/{folder}")
            if clips:
                voices.setdefault(kind, []).extend(clips)
        for rel, role in roles.items():
            if rel.startswith(f"audio/units/{d.name}/canonical/") and role in ("move", "attack", "death"):
                o = m.add(rel, "voice")
                if o:
                    voices.setdefault(role, []).append(o)
        if voices and d.name in factions:
            units[d.name] = {"name": title(d.name), "faction": factions[d.name], "voices": voices}

    buildings = {}
    for d in sorted((src / "audio/buildings").iterdir()):
        clips = m.folder(f"audio/buildings/{d.name}") + m.folder(f"audio/buildings/{d.name}/tap")
        fac = next((f for f, ids in BUILDING_FACTION.items() if d.name in ids), None)
        if clips and fac:
            img = m.add(f"images/buildings_hd/{d.name}.jpg", "image")
            buildings[d.name] = {"name": title(d.name), "faction": fac, "voices": {"tap": clips}, "image": img}

    ann = "audio/announcer/terran"
    announcer = {
        "round": {str(n): m.add(f"{ann}/Round {n}.ogg", "voice") for n in range(1, 11)},
        "phase": {"movement": m.add(f"{ann}/Movement.ogg", "voice"), "assault": m.add(f"{ann}/Assault.ogg", "voice"),
                  "combat": m.add(f"{ann}/Combat.ogg", "voice"), "scoring": m.add(f"{ann}/Scoring clean.ogg", "voice")},
        "victory": {"terran": m.add(f"{ann}/Terran vic.ogg", "voice"), "protoss": m.add(f"{ann}/Protoss vic.ogg", "voice"),
                    "zerg": m.add(f"{ann}/Zerg Victory.ogg", "voice")},
    }
    mi = "audio/ui/match_intro"
    intro = {
        "gameStart": m.folder(f"{mi}/game_start"),
        "glhf": m.folder(f"{mi}/glhf") + m.folder(f"{mi}/glhf_literal"),
        "faction": {f: m.folder(f"{mi}/faction_opening/{f}") for f in ("terran", "protoss", "zerg")},
    }
    ra, rm = "audio/ui/result_audio", "audio/ui/result_music"
    results = {
        "win": {f: m.folder(f"{ra}/{f}") + m.folder(f"audio/ui/victory_endgame/{f}") for f in ("terran", "protoss", "zerg")},
        "neutral": m.folder(f"{ra}/neutral") + m.folder("audio/ui/victory_endgame/generic") + m.folder("audio/ui/gg_ceremony"),
        "tie": m.folder(f"{ra}/tie") + m.folder("audio/ui/tie_endgame"),
        "music": {k: m.folder(f"{rm}/{k}", "music") for k in ("terran", "protoss", "zerg", "victory", "draw")},
    }

    def tracks(rel):
        return [{"src": o, "title": track_title(Path(o).stem)} for o in m.folder(rel, "music")]

    music = {era: {f: tracks(f"audio/music/{era}/{f}") for f in ("terran", "protoss", "zerg")} for era in ("sc1", "sc2")}
    music["menu"] = tracks("audio/music/menu")

    ui = {k: m.add(f"audio/ui/intro/{v}", "voice") for k, v in
          {"beep": "button_beep.wav", "doorOpen": "door_open.wav", "doorClose": "door_close.wav"}.items()}
    rules_images = {Path(o).stem.replace("_reference", ""): o for o in m.folder("images/rules", "image")}

    manifest = {"units": units, "buildings": buildings, "announcer": announcer, "intro": intro,
                "results": results, "music": music, "ui": ui, "rulesImages": rules_images,
                "labels": {k: v for k, v in labels(src).items() if k in m.files}}
    return m, manifest


def encode(src: Path, dst: Path, kind: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".tmp" + dst.suffix)
    if kind == "image":
        cmd = ["cwebp", "-quiet", "-q", "80", "-resize", "1200", "0", str(src), "-o", str(tmp)]
    else:
        music = kind == "music"
        cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-vn",
               "-ac", "2" if music else "1", "-c:a", "aac", "-b:a", "96k" if music else "48k",
               "-movflags", "+faststart", str(tmp)]
    subprocess.run(cmd, check=True)
    tmp.replace(dst)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--seed", type=Path)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not (a.src / "audio").is_dir():
        sys.exit(f"no audio folder in {a.src}")

    media, manifest = collect(a.src)
    todo = []
    for o, (rel, kind) in media.files.items():
        s, d = a.src / rel, OUT_MEDIA / o
        if d.exists() and d.stat().st_mtime >= s.stat().st_mtime:
            continue
        seed = a.seed / o if a.seed else None
        if seed and seed.exists() and not a.dry_run:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(seed, d)
            os.utime(d)
            continue
        todo.append((s, d, kind))

    stale = [p for p in OUT_MEDIA.rglob("*") if p.is_file() and str(p.relative_to(OUT_MEDIA)) not in media.files] \
        if OUT_MEDIA.exists() else []
    print(f"{len(media.files)} files selected, {len(todo)} to encode, {len(stale)} stale")
    if a.dry_run:
        return
    for p in stale:
        p.unlink()
    with ThreadPoolExecutor(a.jobs) as pool:
        for i, _ in enumerate(pool.map(lambda t: encode(*t), todo), 1):
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}")

    sizes = {o: (OUT_MEDIA / o).stat().st_size for o in media.files}
    manifest["sizes"] = {"total": sum(sizes.values()), "files": len(sizes)}
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    OUT_DATA.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    # Every media file with its size, for "save for offline" (the app downloads these into its cache).
    (OUT_DATA.parent / "media-files.json").write_text(json.dumps(dict(sorted(sizes.items())), separators=(",", ":")), encoding="utf8")
    n = len(manifest["units"])
    print(f"media.json: {n} units, {len(manifest['buildings'])} buildings, {sum(sizes.values()) / 1e6:.1f} MB of media")


if __name__ == "__main__":
    main()
