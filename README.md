# TMG Command

A fan-made table companion for **StarCraft: The Miniatures Game**. It is a web app: one address works
on iPhone, Android and desktop browsers, and it can be installed to the home screen and used offline.

Not affiliated with or endorsed by Blizzard Entertainment or Archon Studio.

## What it does

- **Game tracker**: players, factions, mission, rounds and phases, victory points, the Supply Pool per
  round, a game clock and the result. An announcer calls rounds and phases.
- **Unit tracker**: load each player's army list into the game and track every unit's status
  (reserve, on table, lost), damage, Non-Lethal Damage, models left and shields, and mark each
  Active or Reaction ability as used per round. Supply on the table is worked out from the units and
  checked against the Supply Pool.
- **Game log**: every phase, score, deployment, damage, ability use and note, by round and phase,
  with copy or share.
- **Army lists**: the Army Builder, with saved lists that the game tracker reads.
- **Units and cards**: every unit's stats, weapons, abilities and upgrades; Faction, Tactical and
  Creep cards; a voice board for units and buildings.
- **Rulebook**: the core rules with a table of contents, search across rules, glossary, FAQ, abilities
  and units, and links: keywords open their glossary entry, section numbers jump to that section.
- **Music**: soundtrack playlists with a mini-player that keeps playing on every screen.

## Project layout

```
site/                 the app, exactly as it is published (no build step)
  index.html, sw.js, manifest.webmanifest
  css/app.css
  js/                 app.js (shell and routing), lib.js, audio.js, game.js, armies.js,
                      ruletext.js, unitcard.js, screens/*.js (one file per screen)
  army/index.html     the Army Builder page (generated)
  data/*.json         rules, unit data and the media manifest (generated)
  media/              voices, music and images (generated)
tools/
  build_media.py      audio and images  -> site/media + site/data/media.json
  build_rules.py      rulebook text     -> site/data/rules.json
  build_army.py       Army Builder page -> site/army + site/data/army.json
  test_rules.py       checks on rules.json
  serve.py            local web server for testing
.github/workflows/pages.yml   publishes site/ to GitHub Pages
```

The app is plain HTML, CSS and JavaScript modules. Nothing needs installing to run it.

## Run it locally

```bash
python3 tools/serve.py 8780
```

Then open <http://localhost:8780>.

## Publish it (GitHub Pages)

1. Push this repository to GitHub.
2. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Every push to `main` then publishes `site/`. The address is
   `https://<your-account>.github.io/<repository>/`.

On a phone, open that address and add it to the home screen (iPhone: Share → Add to Home Screen;
Android: browser menu → Install app). In the app, **Settings → Use offline** saves the sounds so the
app works with no signal.

## Rebuilding the generated files

Only needed when the source material changes. `build_media.py` needs `ffmpeg` and `cwebp`.

```bash
python3 tools/build_media.py --src /path/to/assets
python3 tools/build_rules.py --src /path/to/assets/rules
python3 tools/build_army.py /path/to/starcraft-tmg-army-builder.html
python3 tools/test_rules.py
```

Run `build_media.py` before `build_army.py`: the second matches units to their voice lines.

## Where the content comes from

- **Code**: written for this project.
- **StarCraft** names, sounds and artwork belong to Blizzard Entertainment. The game rules and card
  text belong to Archon Studio. They are included here for players' convenience at the table; if a
  rights holder asks for something to be removed, remove it.

## Privacy and security

- No accounts, no tracking, no network calls to anyone but the site itself. Games, army lists and
  settings stay in the browser's local storage.
- A Content Security Policy blocks third-party scripts and connections. All text from data files is
  inserted as text, never as HTML.
