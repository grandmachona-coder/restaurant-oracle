# Restaurant Oracle — Backtest Mock Testbed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reproducible backtest harness that seeds ~1,000 real recipes + full mock inventory, locations, menu/prep targets into Restaurant Oracle, then validates interconnectivity, shopping-list math, and (critically) unit-conversion correctness across every tab.

**Architecture:** Four layers, all under `/backtest/` — **zero modifications to `firebase/`, `index.html` (root), `functions/`, `firestore.rules`, `firebase.json`, `.firebaserc`, or any other prod file**:
1. **Acquisition** — `backtest/data/` holds raw recipe corpus (RecipeNLG sample, 1k rows) plus normalized JSON.
2. **Seed pipeline** — Python scripts under `backtest/pipeline/` parse ingredient strings (qty, unit, name), canonicalize units, build per-ingredient conversions, emit `backtest/output/testbed-import.json` matching exact shape consumed by `importData()` at [firebase/public/index.html:7179](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html).
3. **App fork (copy-on-write)** — `backtest/app-fork/` holds a **copy** of `firebase/public/*.html` with auth short-circuit patched. Real `firebase/public/` untouched. Resync script (`backtest/bin/resync-fork.sh`) pulls latest prod files on demand and re-applies backtest patches.
4. **Test harness** — `backtest/tests/` runs against a **separate** emulator project ID (`restaurant-oracle-backtest`, never `restaurant-oracle`); Playwright + Node scripts load seed, drive each tab, assert inventory ↔ recipes ↔ preps ↔ menus ↔ shopping + unit-math invariants.

### Isolation rules (enforced by Task 0.3 preflight)
- **Physical separation via git worktree** — prod checkout at `/Users/mulefamily/Claude/Restaurant-Oracle/` is never entered during backtest execution. Work happens in a sibling worktree at `/Users/mulefamily/Claude/Restaurant-Oracle.backtest/` on branch `backtest/harness`. Same `.git` object store, separate working directories — operations in one cannot touch files in the other.
- **No edits** to any file outside `/backtest/` within the worktree except `.gitignore` (to exclude `backtest/data/raw/`, `backtest/output/`, `backtest/node_modules/`).
- **No deploys** — every emulator command uses `--project restaurant-oracle-backtest`; `.firebaserc` never modified.
- **No prod Firebase credentials** — emulator runs with anonymous local auth; `GOOGLE_APPLICATION_CREDENTIALS` unset during backtest runs.
- **Network isolation** — emulator binds to `127.0.0.1` only (default).
- **Preflight script** runs before every task commit; hard-fails if (a) executing outside the backtest worktree, (b) any diff outside `backtest/` + `docs/plans/`, (c) any prod config changed in branch history.
- **No PR merge to `main`** until human review. `backtest/harness` is a scratch branch; can be archived or deleted when testbed retires.

**Tech Stack:** Python 3.11 (pandas, pint for units, ingredient-parser-nlp), Node 22, Firebase Emulators (auth/firestore/functions/hosting), Playwright (Node) for browser-driven assertions, Vitest for pure-JS unit-math tests.

**Target data shape (reference):**
- `D.ings`: `{id, name, catId, areaId, subArea, defUnit, cost, minQty, autoShop, archived, standalone}`
- `D.recs`: `{id, name, group, catId, yield, yieldUnit, ings:[{ingId, qty, unit}], subRecs, menuItems, archived}`
- `D.preps`: `{id, name, recId, onHand, tgt, unit, areaId}`
- `D.menus`: `{id, name, catId, tgt, unitId, ings, recs, preps, includeInShop, includeInPrep}`
- `D.inv`: `{id, areaId, subArea, ingId, recId, menuId, qty, unit}`
- `D.conversions`: `{id, ingId, storageUnit, recipeUnit, factor}` — **per-ingredient, not global**
- `D.units`: `{id, name, abbr}` — 45 defaults shipped (see `getDefaultUnits()` at line 1440)

---

## Phase 0 — Guardrails & Conventions

### Task 0.0: Create isolated worktree (maximum separation)

**Why worktree, not branch:** Prod checkout at `/Users/mulefamily/Claude/Restaurant-Oracle/` currently has a large uncommitted tree (2026-04-24 deploy in progress). Plain branching carries that dirty state; stashing is one `git stash pop` away from corruption. A worktree gives a physically separate working directory on a fresh branch sharing the same `.git` object store — prod dir cannot be touched by backtest operations because backtest commands execute in a different directory entirely.

**Step 1:** From prod checkout:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
git worktree add -b backtest/harness ../Restaurant-Oracle.backtest main
```

**Step 2:** Verify isolation:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle.backtest
git status                            # must be clean
git branch --show-current             # must print backtest/harness
pwd                                   # must be ../Restaurant-Oracle.backtest
```

**Step 3:** Every subsequent task runs from `/Users/mulefamily/Claude/Restaurant-Oracle.backtest/`. Prod dir never `cd`'d into during execution.

**Step 4:** Cleanup plan (post-merge or abandon):
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
git worktree remove ../Restaurant-Oracle.backtest
git branch -D backtest/harness        # only if abandoning
```

**Step 5:** Commit marker inside the worktree:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle.backtest
git commit --allow-empty -m "chore(backtest): open isolation worktree"
```

### Task 0.1: Create backtest skeleton

**Files:**
- Create: `backtest/README.md`
- Create: `backtest/.gitignore` (ignore `data/raw/`, `output/*.json`, `node_modules/`, `__pycache__/`, `.venv/`)
- Create: `backtest/package.json` (private workspace, deps: `playwright`, `vitest`, `firebase-tools`, `@firebase/rules-unit-testing`)
- Create: `backtest/pyproject.toml` (deps: `pandas`, `pint`, `ingredient-parser-nlp`, `unidecode`, `kaggle`)

**Step 1:** Write `README.md` with exact commands to reproduce:
```
./backtest/bin/setup.sh        # install deps
./backtest/bin/fetch.sh        # download recipe corpus
./backtest/bin/normalize.sh    # build testbed-import.json
./backtest/bin/emulate.sh      # launch emulators
./backtest/bin/seed.sh         # import into emulator
./backtest/bin/test.sh         # run all assertions
./backtest/bin/reset.sh        # wipe emulator state
```

**Step 2:** Commit: `git commit -m "feat(backtest): scaffold harness directory"`

---

### Task 0.3: Preflight guard — block any accidental prod edit

**Files:**
- Create: `backtest/bin/preflight.sh`

**Script:**
```bash
#!/usr/bin/env bash
set -euo pipefail
# MUST run from worktree, never from prod checkout
wt=$(git rev-parse --show-toplevel)
if [[ "$(basename "$wt")" != "Restaurant-Oracle.backtest" ]]; then
  echo "❌ preflight must run inside the backtest worktree, not prod dir"
  exit 1
fi
cd "$wt"
# list all modified files outside backtest/ and docs/
violations=$(git status --porcelain | awk '{print $2}' | grep -Ev '^(backtest/|docs/plans/)' || true)
if [[ -n "$violations" ]]; then
  echo "❌ PRODUCTION FILES MODIFIED in worktree — backtest must not touch them:"
  echo "$violations"
  exit 1
fi
# verify .firebaserc + key prod configs untouched in branch history
if git log --oneline main..HEAD -- .firebaserc firebase.json firebase/firebase.json firebase/firestore.rules firebase/functions/index.js firebase/public/index.html | grep .; then
  echo "❌ prod firebase config changed in this branch history"
  exit 1
fi
echo "✅ preflight OK — no prod files touched, worktree isolated"
```

**Step 1:** Write script, `chmod +x`.
**Step 2:** Run: `./backtest/bin/preflight.sh` — expect `✅ preflight OK`.
**Step 3:** Wire into `backtest/bin/run-all.sh` as first step.
**Step 4:** Commit: `git commit -m "feat(backtest): preflight prod-isolation guard"`

---

### Task 0.2: Pick license-compatible corpus + record decision

**Files:**
- Create: `backtest/docs/DATA_SOURCE.md`

**Content:**
- **Primary:** RecipeNLG (2.23M recipes, pre-parsed `NER` column with ingredient names, structured `ingredients` as JSON-style strings). Research-only license — acceptable for a local backtest, never ship to prod.
- **Fallback:** TheMealDB API (~300 recipes, free tier, fields `strIngredient1..20` + `strMeasure1..20`). Used only if RecipeNLG download is blocked.
- **Rejected:** Recipe1M+ (non-commercial + gate, free-text only), openrecipes (no ingredients by design), Food.com (free-text ingredient field requires separate parser — only use as second-tier).

**Step 1:** Commit `DATA_SOURCE.md` as the decision record.

---

## Phase 1 — Recipe Acquisition

### Task 1.1: Download RecipeNLG corpus

**Files:**
- Create: `backtest/bin/fetch.sh`
- Create: `backtest/data/raw/.gitkeep`

**Step 1 (test first):** Create `backtest/tests/pipeline/test_fetch.py`:
```python
from pathlib import Path
def test_corpus_present():
    root = Path(__file__).parents[2] / "data/raw"
    csvs = list(root.glob("*.csv"))
    assert csvs, "no RecipeNLG csv found"
    assert any("full_dataset" in p.name for p in csvs)
```

**Step 2 (impl):** `bin/fetch.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f data/raw/full_dataset.csv ]]; then
  kaggle datasets download -d paultimothymooney/recipenlg -p data/raw
  unzip -o data/raw/recipenlg.zip -d data/raw
fi
wc -l data/raw/full_dataset.csv
```

**Step 3:** Run: `./backtest/bin/fetch.sh`. Expected: csv present, line count > 2,000,000. If kaggle auth missing, prompt user for `~/.kaggle/kaggle.json` (this is one of the credential cases the user must handle — print the exact URL `https://www.kaggle.com/settings/account` → "Create New Token").

**Step 4:** Run test: `pytest backtest/tests/pipeline/test_fetch.py -v`. Expected: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): fetch RecipeNLG corpus"`

---

### Task 1.2: Sample 1,000 recipes with good ingredient coverage

**Files:**
- Create: `backtest/pipeline/sample.py`
- Create: `backtest/data/staged/sample.jsonl`

**Step 1 (test):** `backtest/tests/pipeline/test_sample.py`:
```python
import json
from pathlib import Path
def test_sample_size():
    rows = [json.loads(l) for l in Path("backtest/data/staged/sample.jsonl").read_text().splitlines()]
    assert len(rows) == 1000
    for r in rows:
        assert r["title"]
        assert isinstance(r["ingredients"], list) and 2 <= len(r["ingredients"]) <= 40
        assert isinstance(r["ner"], list) and len(r["ner"]) >= 2
```

**Step 2 (impl):** `sample.py` reads `full_dataset.csv` with pandas, filters `source == "Gathered"`, drops rows with `len(ner) < 2` or `> 30`, drops duplicate titles, uses fixed-seed `sample(n=1000, random_state=42)`. Writes JSONL.

**Step 3:** Run: `python backtest/pipeline/sample.py`. Verify line count: `wc -l backtest/data/staged/sample.jsonl` → 1000.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): sample 1k recipes with stable seed"`

---

## Phase 2 — Unit Normalization & Ingredient Parsing (critical)

### Task 2.1: Canonical unit master

**Files:**
- Create: `backtest/pipeline/units.py`
- Read first: [firebase/public/index.html:1440-1451](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) to grab the exact `getDefaultUnits()` set.

**Step 1 (test):** `backtest/tests/pipeline/test_units.py`:
```python
from backtest.pipeline.units import UNITS, canonicalize
def test_volume_aliases():
    assert canonicalize("tbsp") == "tbsp"
    assert canonicalize("tablespoon") == "tbsp"
    assert canonicalize("Tbsp.") == "tbsp"
    assert canonicalize("T")    == "tbsp"
def test_mass_aliases():
    assert canonicalize("oz")   == "oz"
    assert canonicalize("ounce") == "oz"
    assert canonicalize("lb")   == "lb"
    assert canonicalize("pound") == "lb"
def test_count_aliases():
    assert canonicalize("ea")   == "each"
    assert canonicalize("pc")   == "each"
    assert canonicalize("clove") == "clove"
def test_unknown():
    assert canonicalize("blorp") is None
```

**Step 2 (impl):** `units.py` exports `UNITS` (dict keyed by Oracle-native abbreviation: `each, ea, pc, g, kg, oz, lb, ml, l, tsp, tbsp, cup, floz, pt, qt, gal, clove, slice, bunch, head, pinch, dash, can, btl, box, bag, case, sheet, doz, sprig, leaf, stick`) plus alias map. `canonicalize(str)` lowercases, strips punctuation, maps alias → canonical, returns None if unknown.

**Step 3:** Run test: PASS.

**Step 4:** Commit: `git commit -m "feat(backtest): canonical unit map matching Oracle getDefaultUnits"`

---

### Task 2.2: Ingredient-line parser (quantity + unit + name)

**Files:**
- Create: `backtest/pipeline/parse_ing.py`

**Step 1 (test):** `backtest/tests/pipeline/test_parse_ing.py`:
```python
from backtest.pipeline.parse_ing import parse
def test_simple():
    assert parse("2 cups all-purpose flour") == (2.0, "cup", "all-purpose flour")
def test_fraction():
    assert parse("1 1/2 tsp kosher salt") == (1.5, "tsp", "kosher salt")
def test_unicode_frac():
    assert parse("¾ cup sugar") == (0.75, "cup", "sugar")
def test_count_noun():
    assert parse("3 eggs, beaten") == (3.0, "each", "eggs")
def test_parenthetical():
    assert parse("1 (14-ounce) can black beans") == (14.0, "oz", "black beans")
def test_range_collapsed():
    # "2-3 cloves garlic" → midpoint 2.5
    assert parse("2-3 cloves garlic") == (2.5, "clove", "garlic")
def test_unknown_unit_falls_back():
    assert parse("a pinch of saffron") == (1.0, "pinch", "saffron")
def test_no_qty_defaults_to_1():
    assert parse("salt to taste") == (1.0, "each", "salt")
```

**Step 2 (impl):** `parse_ing.py` tries `ingredient-parser-nlp` first; falls back to a rule-based regex pipeline: unicode fractions → ascii, range → midpoint, parenthetical size takes precedence over outer qty, unit lookup via `units.canonicalize()`. Always returns a 3-tuple; no Nones.

**Step 3:** Run tests: PASS (all 8).

**Step 4:** Commit: `git commit -m "feat(backtest): robust ingredient-line parser"`

---

### Task 2.3: Ingredient deduper / canonical name map

**Files:**
- Create: `backtest/pipeline/dedupe.py`
- Create: `backtest/data/staged/ingredient_map.json` (output)

**Step 1 (test):** `backtest/tests/pipeline/test_dedupe.py`:
```python
from backtest.pipeline.dedupe import canon_name
def test_strips_modifiers():
    assert canon_name("kosher salt")      == "salt"
    assert canon_name("fresh basil")      == "basil"
    assert canon_name("chopped onion")    == "onion"
    assert canon_name("all-purpose flour")== "flour"
def test_plurals():
    assert canon_name("eggs")             == "egg"
    assert canon_name("tomatoes")         == "tomato"
def test_brand_removal():
    assert canon_name("Kraft parmesan")   == "parmesan"
```

**Step 2 (impl):** `dedupe.py` strips a known modifier set (`fresh, dried, chopped, diced, minced, sliced, grated, ...`), known size adjectives (`large, small, medium`), common brands, singularizes via `inflect` lib. Walks all 1k recipes, builds `{raw_name: canonical_name}` map, drops ingredients appearing in fewer than 2 recipes (reduces long-tail noise). Expected output: 200-400 canonical ingredients.

**Step 3:** Run: `python backtest/pipeline/dedupe.py`. Log: `len(canonical) = XXX`.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): canonical ingredient deduper"`

---

### Task 2.4: Per-ingredient unit-conversion table

This is **THE** critical piece for the user's "special focus on units." Oracle stores conversions per ingredient (`D.conversions` has `ingId, storageUnit, recipeUnit, factor`). We need realistic conversions so shopping-list math works across mixed units.

**Files:**
- Create: `backtest/pipeline/conversions.py`
- Create: `backtest/data/staged/conversions.json`

**Reference data** (cite sources in comments):
- USDA FoodData Central density per 100g for common ingredients
- pint (Python) handles all volume↔volume and mass↔mass conversions free; we only need to set **one density per ingredient** to cross dimensions

**Step 1 (test):** `backtest/tests/pipeline/test_conversions.py`:
```python
from backtest.pipeline.conversions import for_ingredient
import math
def test_flour():
    c = for_ingredient("flour")
    # 1 cup all-purpose flour ≈ 125 g
    assert math.isclose(c.cup_to_g(1), 125, rel_tol=0.05)
def test_sugar():
    c = for_ingredient("sugar")
    assert math.isclose(c.cup_to_g(1), 200, rel_tol=0.05)
def test_water():
    c = for_ingredient("water")
    assert math.isclose(c.cup_to_g(1), 237, rel_tol=0.02)   # 236.6 ml * 1 g/ml
def test_butter():
    c = for_ingredient("butter")
    assert math.isclose(c.tbsp_to_g(1), 14, rel_tol=0.1)
def test_count_ingredient_has_no_density():
    c = for_ingredient("egg")
    # count-native ingredient: factor to mass is average (50g / each)
    assert math.isclose(c.each_to_g(1), 50, rel_tol=0.2)
```

**Step 2 (impl):** `conversions.py` ships a small hand-curated density table (20-30 staples: flour, sugar, salt, butter, oil, milk, water, rice, various). For ingredients *not* in the table: falls back to `50g / each` for count-nouns, or emits a conversion record only for volume↔volume (via pint). Each `D.conversions` row gets `{ingId, storageUnit: <dominant unit in corpus>, recipeUnit: <secondary unit in corpus>, factor}`.

**Dominant unit rule:** for each canonical ingredient, count how often each unit appears in the 1k recipes; `storageUnit` = most common unit the operator buys (lb/g/each/gal), `recipeUnit` = most common recipe unit (cup/tbsp/each). This matches how the Oracle app is used in practice.

**Step 3:** Run: `python backtest/pipeline/conversions.py`. Output: `conversions.json` with one row per ingredient that has a meaningful cross-unit mapping.

**Step 4:** Run tests: PASS (5/5).

**Step 5:** Commit: `git commit -m "feat(backtest): per-ingredient unit-conversion table"`

---

### Task 2.5: Build the testbed import JSON (D-shape)

**Files:**
- Create: `backtest/pipeline/build_import.py`
- Create: `backtest/output/testbed-import.json`

**Step 1 (test):** `backtest/tests/pipeline/test_build_import.py`:
```python
import json
from pathlib import Path
def test_shape():
    d = json.loads(Path("backtest/output/testbed-import.json").read_text())
    assert d["version"]
    assert d["exportDate"]
    data = d["data"]
    for k in ("ings","recs","preps","menus","inv","areas","cats","recCats","menuCats","units","conversions","shopping","settings","log","users"):
        assert k in data, f"missing {k}"
    assert len(data["recs"]) == 1000
    assert 200 <= len(data["ings"]) <= 400
    assert all("ings" in r and isinstance(r["ings"], list) for r in data["recs"])
    # every recIng must point at a real ingId
    ing_ids = {i["id"] for i in data["ings"]}
    for r in data["recs"]:
        for ri in r["ings"]:
            assert ri["ingId"] in ing_ids
            assert isinstance(ri["qty"], (int,float))
            assert ri["unit"]
```

**Step 2 (impl):** `build_import.py`:
1. Load `sample.jsonl`, `ingredient_map.json`, `conversions.json`.
2. Assign integer IDs starting at `nid=1` to every ingredient, recipe, etc. (the app uses auto-increment int IDs).
3. For each recipe → build `{id, name, ings:[...], yield, yieldUnit, catId}`. Pick `yield` as median of similar recipes in the corpus; default `yieldUnit = "serving"`.
4. For each ingredient line → `{ingId, qty: <parsed>, unit: <canonical>}`.
5. Populate `D.units` from Task 2.1's master.
6. Populate `D.conversions` from Task 2.4.
7. `D.cats`: `[Dry,Produce,Dairy,Meat,Seafood,Pantry,Frozen,Beverage,Spice]` (9 ingredient cats).
8. `D.recCats`: `[Breakfast,Appetizer,Entree,Side,Dessert,Sauce,Baked,Drink]`.
9. Leave `D.inv`, `D.preps`, `D.menus`, `D.areas` empty — those are generated in Phase 4.
10. Wrap in `{version, exportDate, data:{...}}` envelope matching `exportData()` at index.html:7032.

**Step 3:** Run: `python backtest/pipeline/build_import.py`. Size check: file should be 2-5 MB.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): build D-shape testbed-import.json"`

---

## Phase 3 — Testbed Infrastructure

### Task 3.1: Fork app into `backtest/app-fork/` (copy-on-write — NO prod edits)

**Problem:** Oracle's auth flow requires Google OAuth + approved-email + tenant claims. Need local-only bypass **without touching `firebase/public/*`**.

**Approach:** Copy the whole `firebase/public/` tree into `backtest/app-fork/` once. Patch only the fork. Real prod files never modified. Resync script rebases the patch if prod moves.

**Files:**
- Create: `backtest/app-fork/` (starts empty — populated by resync script)
- Create: `backtest/bin/resync-fork.sh`
- Create: `backtest/patches/001-backtest-auth-shortcircuit.patch`
- Create: `backtest/firebase.json` (fork's own hosting config pointing at `app-fork/`)

**`bin/resync-fork.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# copy prod → fork (wipes old fork first so stale files cannot linger)
rm -rf app-fork
cp -R ../firebase/public app-fork
# apply every patch in order
for p in patches/*.patch; do
  git apply --directory=backtest/app-fork "$p" || {
    echo "❌ patch $p failed — prod files drifted. Rebase the patch."
    exit 1
  }
done
# sanity: ensure we NEVER touched prod
./bin/preflight.sh
```

**Patch contents** (`001-backtest-auth-shortcircuit.patch`): unified diff adding an `isBacktestMode()` helper + auth short-circuit inside the fork's `index.html`.

**Hardened rules for backtest mode** (same as before, now living only in the fork):
1. Only honored when `hostname === 'localhost' || '127.0.0.1'` — fork can never be deployed.
2. Only honored when `port === '5055'` (non-standard port reserved for backtest to prevent collision with any developer running prod emulators on 5000).
3. When active: skip OAuth, `TENANT_SLUG='backtest'`, `TENANT_ID='backtest'`, stub `currentAuthUser` locally, all writes localStorage-only.
4. Red banner "BACKTEST MODE — FORK, NOT PROD APP" at top.
5. `manifest.json` renamed to `manifest.backtest.json` to prevent PWA-install confusion.

**`backtest/firebase.json`** (emulator config for the fork — separate from prod):
```json
{
  "hosting": {
    "public": "app-fork",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
  },
  "emulators": {
    "hosting":   { "port": 5055, "host": "127.0.0.1" },
    "firestore": { "port": 8088, "host": "127.0.0.1" },
    "auth":      { "port": 9098, "host": "127.0.0.1" },
    "functions": { "port": 5006, "host": "127.0.0.1" },
    "ui":        { "enabled": true, "port": 4044, "host": "127.0.0.1" }
  }
}
```

**Step 1 (test):** `backtest/tests/harness/fork_isolation.spec.ts`:
```ts
import { execSync } from 'child_process';
test('prod files untouched after fork resync', () => {
  execSync('./backtest/bin/resync-fork.sh');
  const diff = execSync('git status --porcelain firebase/ index.html').toString();
  expect(diff).toBe('');
});
test('fork has backtest banner patched in', () => {
  const html = require('fs').readFileSync('backtest/app-fork/index.html', 'utf8');
  expect(html).toMatch(/isBacktestMode/);
  expect(html).toMatch(/BACKTEST MODE — FORK, NOT PROD APP/);
});
```

**Step 2 (impl):**
1. Run `cp -R firebase/public backtest/app-fork` once manually to get a baseline.
2. Hand-edit `backtest/app-fork/index.html` to add `isBacktestMode()` + banner + auth short-circuit.
3. Generate patch: `diff -u firebase/public/index.html backtest/app-fork/index.html > backtest/patches/001-backtest-auth-shortcircuit.patch`.
4. Delete `backtest/app-fork/`, then regenerate via `resync-fork.sh` to verify the patch applies cleanly from scratch.
5. Run preflight — must be `✅`.

**Step 3:** Run Playwright spec — PASS both assertions.

**Step 4:** Commit: `git commit -m "feat(backtest): app fork with auth short-circuit patch"`

---

### Task 3.2: Backtest-only emulator launch

**Files:**
- Create: `backtest/bin/emulate.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit project ID that can NEVER match prod .firebaserc
export GOOGLE_APPLICATION_CREDENTIALS=""    # ensure no prod creds leak in
firebase emulators:start \
  --only auth,firestore,hosting \
  --project restaurant-oracle-backtest \
  --config backtest/firebase.json
```

**Rules:**
- `--project restaurant-oracle-backtest` — a project name that does not exist in the real Firebase console; any accidental deploy attempt fails.
- `--config backtest/firebase.json` — uses the fork's hosting config (port 5055, `app-fork/` root), not prod's.
- `GOOGLE_APPLICATION_CREDENTIALS` explicitly unset — prevents ADC leak into emulator.
- No `functions` emulator — the fork's auth short-circuit bypasses `secureApi()`, so Cloud Functions never run. This removes any chance of deploying modified function code.

**Step 1:** Write script, `chmod +x`.
**Step 2:** Run: `./backtest/bin/emulate.sh`. Wait for `✔ All emulators ready on 127.0.0.1:5055`. Leave running in background.
**Step 3:** Verify from a second terminal: `curl -s http://127.0.0.1:5055/ | grep -c 'BACKTEST MODE'` → returns ≥ 1.
**Step 4:** Preflight: `./backtest/bin/preflight.sh` → `✅`.
**Step 5:** Commit: `git commit -m "chore(backtest): emulator launch script (isolated project)"`

---

### Task 3.3: Programmatic seed loader

**Files:**
- Create: `backtest/bin/seed.sh`
- Create: `backtest/harness/seed.mjs` (Node script that drives Playwright to load testbed-import.json into the running emulator)

**Step 1 (test):** `backtest/tests/harness/seed.spec.ts`:
```ts
test('seed loads 1000 recipes', async ({ page }) => {
  await page.goto('http://localhost:5000/?backtest=1');
  await page.waitForSelector('#main-app');
  // programmatically invoke importData path, bypassing file picker
  const count = await page.evaluate(async () => {
    const json = await fetch('/testbed-import.json').then(r => r.json());
    window._loadFromJSONForTest(json);
    return window.D.recs.length;
  });
  expect(count).toBe(1000);
});
```

**Step 2 (impl):** 
1. Copy `backtest/output/testbed-import.json` to `backtest/app-fork/testbed-import.json` (fork serves it — **prod `firebase/public/` never gets this file**).
2. Add test-only helper `window._loadFromJSONForTest(json)` inside the fork's `isBacktestMode()` block (via the `001` patch); deep-copies payload into `D.*`, calls `rebuildIndexes()`, `render()`. Guard: no-op if `!isBacktestMode()`.
3. `seed.mjs` launches headless Playwright, opens `http://127.0.0.1:5055/?backtest=1`, evaluates loader, screenshots each tab.

**Step 3:** Run: `./backtest/bin/seed.sh`. Expected output: "seeded 1000 recs, 312 ings, 45 units, 278 conversions" plus 8 baseline screenshots under `backtest/output/baseline/`. Preflight must be `✅`.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): programmatic seed loader"`

---

## Phase 4 — Mock Environment Generation (inventory, areas, preps, menus, targets)

### Task 4.1: Areas / storage locations

**Files:**
- Create: `backtest/pipeline/gen_areas.py`

**Generate (realistic restaurant layout):**
- Dry Storage — sub-areas: `[Shelf A1..A6, Shelf B1..B4]`, `invFrequency=weekly`
- Walk-In Cooler — sub-areas: `[Top shelf, Middle, Bottom, Produce bin, Dairy shelf]`, `invFrequency=daily`
- Walk-In Freezer — sub-areas: `[Meat, Seafood, Prepared]`, `invFrequency=weekly`
- Bar — sub-areas: `[Well, Back bar, Cooler]`, `invFrequency=weekly`
- Line (expo) — sub-areas: `[Hot line, Cold line, Garde manger]`, `invFrequency=daily`, `prep=true`
- Prep Kitchen — `prep=true`, `invFrequency=daily`
- Warehouse (off-site) — `isWarehouse=true`, `invFrequency=monthly`

**Step 1 (test):** assert 7 areas emitted, each with >=3 sub-areas, at least one `prep=true`, at least one `isWarehouse=true`.

**Step 2 (impl):** simple deterministic generator with fixed seed; emits to `backtest/data/staged/areas.json`.

**Step 3:** Commit: `git commit -m "feat(backtest): generate mock storage areas"`

---

### Task 4.2: Inventory with cross-unit variation (the unit-math torture test)

This task deliberately creates inventory rows that **use different units than the recipes** so the conversion logic at [index.html:4116 convertToRecipeUnits](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) and [:4127 convertToStorageUnits](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) actually gets exercised.

**Files:**
- Create: `backtest/pipeline/gen_inv.py`

**Rules:**
1. Every ingredient gets **at least one** inventory row.
2. 40% of ingredients get **two rows in two different areas** (e.g., flour in Dry Storage *and* on the Line).
3. 60% of ingredient rows use `storageUnit` (from conversions); 30% use `recipeUnit`; 10% use a *third* unit in the same dimension (e.g., ingredient stores in `lb`, recipe uses `cup`, inventory row uses `oz`). This forces unit conversion.
4. Inventory qty distribution: uniform in `[0.25, 3.0] × typical-pack-size` (typical pack size from the dominant-unit corpus stats in Task 2.4).
5. 5% of rows get `outOfStock=true, qty=0` — must trigger shopping-list inclusion.
6. 3% of rows get a non-default unit that does **not** have a conversion defined — documented expected behavior: shopping list emits a warning, does not crash.

**Step 1 (test):** `backtest/tests/pipeline/test_gen_inv.py`:
```python
def test_every_ing_covered():
    inv = load_inv()
    covered = {row["ingId"] for row in inv}
    assert covered == {ing["id"] for ing in load_ings()}
def test_unit_variation():
    # at least 25% of rows use a non-storage unit
    inv = load_inv()
    storage = {i["id"]: conv_for(i["id"]).storageUnit for i in load_ings()}
    mismatched = sum(1 for r in inv if r["unit"] != storage.get(r["ingId"]))
    assert mismatched / len(inv) >= 0.25
def test_out_of_stock_present():
    assert sum(1 for r in load_inv() if r.get("outOfStock")) >= 10
```

**Step 2 (impl):** `gen_inv.py` walks ingredients, emits rows by the rules above with `random.seed(42)`.

**Step 3:** Run tests: PASS.

**Step 4:** Commit: `git commit -m "feat(backtest): inventory with cross-unit variation"`

---

### Task 4.3: Preps with targets + on-hand

**Files:**
- Create: `backtest/pipeline/gen_preps.py`

**Rules:**
1. Select ~120 recipes from the 1k as "prep items" (bases, sauces, batters, dressings — recipes with `yield > 1 serving` OR category in `{Sauce, Baked}`).
2. Each prep: `{id, name, recId, tgt, unit: rec.yieldUnit, onHand: random(0, tgt*1.5), areaId: random prep area}`.
3. 25% of preps have `onHand >= tgt` (covered — shouldn't trigger shopping). 50% have `0 < onHand < tgt` (partial — should trigger partial shopping). 25% have `onHand == 0` (full need).

**Step 1 (test):** shape assertions + distribution ratios ±5%.

**Step 2 (impl):** seed-stable generator.

**Step 3:** Commit: `git commit -m "feat(backtest): generate 120 preps with on-hand distribution"`

---

### Task 4.4: Menu items with targets (including sub-recipes & sub-preps)

**Files:**
- Create: `backtest/pipeline/gen_menus.py`

**Rules:**
1. 60 menu items, split across `menuCats: [Breakfast, Lunch, Dinner, Dessert, Drink]`.
2. Each menu item references **some combination** of: direct ingredients (`menu.ings`), full recipes (`menu.recs`), preps (`menu.preps`). Distribution: 20% ingredients-only, 40% recipes-only, 20% preps-only, 20% mixed.
3. `tgt` (daily sales target) uniform in `[5, 60]`.
4. 80% have `includeInShop=true`; 100% have `includeInPrep=true`.
5. Deliberately include at least 5 menu items that chain through **2 levels of sub-recipes** (menu → recipe → sub-recipe → ingredient) to exercise `expandRecipeIngredients()` at [index.html:4071](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html).
6. Deliberately include 5 menu items whose recipes use an ingredient in a unit different from that ingredient's `storageUnit` and different from inventory's unit — 3-way unit mismatch.

**Step 1 (test):** shape + sub-recipe depth + 3-way mismatch count.

**Step 2 (impl):** seed-stable generator.

**Step 3:** Commit: `git commit -m "feat(backtest): generate 60 menu items with sub-recipe chains"`

---

### Task 4.5: Merge all generated tables into final import JSON

**Files:**
- Modify: `backtest/pipeline/build_import.py` — add a `--with-mock` flag that pulls `areas.json, inv.json, preps.json, menus.json` from `data/staged/` and stitches them in.

**Step 1 (test):** run test_build_import.py again with non-empty inv/preps/menus/areas.

**Step 2 (impl):** straight merge.

**Step 3:** Run: `python backtest/pipeline/build_import.py --with-mock`. Verify final `testbed-import.json` has all non-empty tables.

**Step 4:** Commit: `git commit -m "feat(backtest): stitch mock env into testbed-import.json"`

---

## Phase 5 — Unit-Conversion Math Tests (special focus)

### Task 5.1: Extract pure conversion functions to standalone module for isolated testing

**Problem:** `convertToStorage`, `convertToRecipe`, `convertToRecipeUnits`, `convertToStorageUnits` are currently inline in index.html. To property-test them in Vitest, we mirror the logic into `backtest/harness/conversions.mjs` (a line-identical copy) and also run integration tests through the real browser.

**Files:**
- Create: `backtest/harness/conversions.mjs` — verbatim copy of the 4 functions from index.html lines ~2786-2795 and 4116-4138, with `IDX.conversions` replaced by an injected map.

**Step 1 (test):** `backtest/tests/unit/conversions.spec.ts`:
```ts
import { convertToRecipeUnits, convertToStorageUnits } from '../../harness/conversions.mjs';
const flour = { ingId: 1, storageUnit: 'lb', recipeUnit: 'cup', factor: 3.5 }; // 1 lb flour ≈ 3.5 cups
const conv = new Map([[1, flour]]);
test('storage → recipe', () => {
  expect(convertToRecipeUnits(conv, 1, 2, 'lb')).toBeCloseTo(7, 3);   // 2 lb × 3.5 = 7 cups
});
test('recipe → storage', () => {
  expect(convertToStorageUnits(conv, 1, 7, 'cup')).toBeCloseTo(2, 3); // 7 cups / 3.5 = 2 lb
});
test('same-unit passthrough', () => {
  expect(convertToRecipeUnits(conv, 1, 5, 'cup')).toBe(5);
});
test('unknown ingredient passthrough', () => {
  expect(convertToRecipeUnits(conv, 999, 5, 'cup')).toBe(5);
});
test('zero factor guards against div by zero', () => {
  const bad = new Map([[1, { ingId:1, storageUnit:'lb', recipeUnit:'cup', factor: 0 }]]);
  expect(convertToStorageUnits(bad, 1, 5, 'cup')).toBe(5); // fall through
});
test('round-trip invariant', () => {
  // for any qty q in recipe unit, storage→recipe should recover q within tolerance
  for (const q of [0.5, 1, 2.5, 7, 100]) {
    const storage = convertToStorageUnits(conv, 1, q, 'cup');
    const back    = convertToRecipeUnits(conv, 1, storage, 'lb');
    expect(back).toBeCloseTo(q, 3);
  }
});
```

**Step 2 (impl):** copy-paste the 4 functions, replace closure refs.

**Step 3:** Run: `npx vitest run backtest/tests/unit`. Expected: all 6 PASS.

**Step 4:** Commit: `git commit -m "test(backtest): round-trip unit-conversion invariants"`

---

### Task 5.2: Property test — recipe-scaling preserves ratios under unit swap

**Files:**
- Create: `backtest/tests/unit/recipe_scale.spec.ts`

**Claim under test:** for any recipe in the seed, multiplying all ingredient quantities by `k` (after converting to a common unit via `convertToRecipeUnits`) then back-converting should equal `k × original`.

**Step 1 (test):**
```ts
import seed from '../../output/testbed-import.json';
import { convertToRecipeUnits, convertToStorageUnits } from '../../harness/conversions.mjs';
const convMap = new Map(seed.data.conversions.map(c => [c.ingId, c]));
for (const k of [0.5, 1, 2, 3, 10]) {
  test(`scale by ${k} preserves ratio`, () => {
    for (const rec of seed.data.recs.slice(0, 100)) {                 // sample
      for (const ri of rec.ings) {
        const storage = convertToStorageUnits(convMap, ri.ingId, ri.qty, ri.unit);
        const scaled  = storage * k;
        const back    = convertToRecipeUnits(convMap, ri.ingId, scaled, storage ? convMap.get(ri.ingId)?.storageUnit : ri.unit);
        expect(back).toBeCloseTo(ri.qty * k, 3);
      }
    }
  });
}
```

**Step 2:** Run. Expect: 5 test groups PASS. Any failure → inspect the offending `conv` row; likely a missing conversion.

**Step 3:** Commit: `git commit -m "test(backtest): recipe-scale ratio invariants over 1k corpus"`

---

## Phase 6 — Interconnectivity Tests (per tab, cross-tab)

Each of the 8 tabs (Inventory, Ingredients, Recipes, Menus, Prep, Shopping, Log, Admin) gets a Playwright spec that loads the seeded emulator, navigates, and asserts rendering + cross-references.

### Task 6.1: Inventory tab

**Files:**
- Create: `backtest/tests/harness/tab_inventory.spec.ts`

**Asserts:**
1. Every area from `D.areas` renders as a row/card.
2. Clicking an area expands to show every inventory row for that area.
3. Sum of inventory rows per ingredient matches the generator output.
4. Filter by "out of stock" shows exactly the 5% flagged rows.
5. Editing a row qty persists via `markChanged()` (listener-free in backtest mode; asserts `D.inv[i].qty` mutated + `changeLog.inv.has(id)`).

**Step 1:** Write test + assertions.  
**Step 2:** Run — PASS.  
**Step 3:** Commit: `git commit -m "test(backtest): inventory tab interconnectivity"`

---

### Task 6.2: Ingredients tab

**Files:**
- Create: `backtest/tests/harness/tab_ingredients.spec.ts`

**Asserts:**
1. 200-400 ingredient rows render.
2. Each ingredient's "used in" column correctly lists recipes / menus / preps that reference it (reverse index via IDX).
3. Filter by category shrinks the list.
4. Search by substring matches canonical + alias names.
5. `archived=true` ingredients hidden by default, shown when toggle flipped.

**Steps 1-3:** Same pattern.

---

### Task 6.3: Recipes tab

**Files:**
- Create: `backtest/tests/harness/tab_recipes.spec.ts`

**Asserts:**
1. 1000 recipes render (paginated or virtualized — check `recs-list` child count or page counter).
2. Expanding a recipe shows each `recIng` row with `{ingredient name, qty, unit}` and a resolved cost (unit-converted to ingredient's `cost` basis).
3. For each of the 5 recipes with sub-recipe chains (from Task 4.4), the expanded ingredient list recursively unfolds via `expandRecipeIngredients()` at [index.html:4071](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) — assert depth ≥ 2.
4. Recipe yield editable; changing `yield` from 4→8 doubles every displayed ingredient qty.
5. Clicking "add to prep" creates a prep entry (or updates existing); cross-tab check the Prep tab reflects new item.

---

### Task 6.4: Menus tab

**Files:**
- Create: `backtest/tests/harness/tab_menus.spec.ts`

**Asserts:**
1. 60 menu items render across 5 menu cats.
2. Each menu item shows total ingredient requirement = `tgt × (direct ings + recipe-expanded ings + prep ings)`.
3. Toggling `includeInShop` to false removes that menu's demand from the shopping list (verify in 6.6).
4. The 5 two-level sub-recipe chains expand correctly in the menu breakdown.

---

### Task 6.5: Prep tab

**Files:**
- Create: `backtest/tests/harness/tab_prep.spec.ts`

**Asserts:**
1. 120 prep items render with `{onHand, tgt, unit}`.
2. "+1 batch ✓" button increments `onHand` by the recipe yield; session-count badge + pulse animation fire (regression check for the 2026-04-24 fix — memory line 339).
3. Preps where `onHand ≥ tgt` badge as "covered"; preps where `onHand == 0` badge as "needed".
4. Clicking "gen from recipe" correctly pulls the recipe's ingredient list.

---

### Task 6.6: Shopping tab — **the master integration check**

**Files:**
- Create: `backtest/tests/harness/tab_shopping.spec.ts`

**Asserts (the user's core requirement):**

**Golden formula** (for each ingredient `i`):
```
needed(i)   = Σ over menus (tgt × direct_ing_qty) 
            + Σ over menus (tgt × recipe_expanded_qty from calcRecipeOutput) 
            + Σ over menus (tgt × prep_expanded_qty)
            + Σ over preps  (max(0, tgt − onHand) × recipe_expanded_qty)

have(i)     = Σ over inv rows for i (converted to ingredient.defUnit via convertToRecipeUnits)

shortfall(i) = max(0, needed(i) − have(i))

shopping_qty(i) = convertToStorageUnits(shortfall(i), i.defUnit)
```

**Tests (one subsection per invariant):**

1. **Covered by inventory:** force an ingredient's inventory to 10× max needed — shopping list must NOT include it.
2. **Partial shortfall:** force inventory = 0.5 × needed — shopping qty = 0.5 × needed (converted to storage unit).
3. **Prep covers it:** force a prep with `onHand ≥ tgt` that covers a menu dependency — menu's portion drops to 0 (verify via diff before/after `prep.onHand` mutation).
4. **Unit-mismatch:** inventory stored in `oz`, recipe in `cup`, ingredient defUnit `lb`, conversions defined — shopping qty must compute correctly to storage unit (assert with hand-computed number for 10 picked ingredients).
5. **Missing conversion:** one of the 3% ingredients without a conversion → shopping list emits a warning row, qty stays in recipe units, no crash.
6. **Out-of-stock short-circuit:** `outOfStock=true` rows counted as zero regardless of `qty`.
7. **`includeInShop=false` exclusion:** menu flagged false doesn't contribute to demand.
8. **Auto-shop threshold:** ingredient with `autoShop=true` and `qty < minQty` surfaces on the list even if no menu demand.
9. **Total invariant check:** sum of shopping list `qty × cost` (converted) must equal the total-cost widget at the top of the Shopping tab.

**Step 1-3:** Write each sub-assertion, run, commit per group of 3 assertions (3 commits, not one).

---

### Task 6.7: Log tab

**Files:**
- Create: `backtest/tests/harness/tab_log.spec.ts`

**Asserts:**
1. After seeding + running 6.1-6.6 mutations, log has an audit entry per change.
2. Filter by user, by action type works.

---

### Task 6.8: Admin tab

**Files:**
- Create: `backtest/tests/harness/tab_admin.spec.ts`

**Asserts:**
1. Unit management — add a unit, delete a unit, rename.
2. Category management — add/rename/merge.
3. Conversion management — CRUD a `D.conversions` row; confirm the shopping list recomputes correctly (re-trigger Task 6.6 check for that ingredient).

---

## Phase 7 — End-to-End Runner & Report

### Task 7.1: Single-command full-cycle runner

**Files:**
- Create: `backtest/bin/run-all.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./bin/preflight.sh                              # hard stop if prod files dirty
./bin/fetch.sh
python pipeline/sample.py
python pipeline/dedupe.py
python pipeline/conversions.py
python pipeline/gen_areas.py
python pipeline/gen_inv.py
python pipeline/gen_preps.py
python pipeline/gen_menus.py
python pipeline/build_import.py --with-mock
./bin/resync-fork.sh                            # rebuild app-fork + apply patches
cp output/testbed-import.json app-fork/testbed-import.json
./bin/emulate.sh &                              # isolated project on :5055
EMU_PID=$!
trap "kill $EMU_PID; ./bin/preflight.sh" EXIT   # preflight re-runs at shutdown
sleep 10
./bin/seed.sh
npx vitest run backtest/tests/unit
npx playwright test backtest/tests/harness
./bin/preflight.sh                              # final check before exit
```

**Step 1:** Run the full thing end-to-end.

**Step 2:** Commit.

---

### Task 7.2: Coverage report + human-readable summary

**Files:**
- Create: `backtest/bin/report.sh`
- Create: `backtest/output/REPORT.md` (generated)

**Content:** counts, pass/fail per phase, list of any shopping-list invariants that failed with hand-calc vs app-calc diffs, a histogram of unit-mismatch conversion accuracy.

**Step 1:** Implement + run.  
**Step 2:** Commit.

---

## Phase 8 — Documentation & Handoff

### Task 8.1: README + DIAGRAMS

- Update `backtest/README.md` with a data-flow diagram (ingredients → recipes → preps → menus → inventory → shopping).
- Add a "how the unit math actually works" section with worked examples.

### Task 8.2: Archive the seed JSON

- Check the final `testbed-import.json` into a separate `backtest/output/snapshots/2026-04-24.json` so reruns are reproducible without re-downloading the corpus.

### Task 8.3: Commit: `git commit -m "docs(backtest): harness README + diagrams"`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| RecipeNLG Kaggle auth blocked | Fallback to TheMealDB (~300) + synthetic recipe generator to reach 1k |
| Ingredient parser misses unusual formats | Rule-based fallback always returns a tuple; log unparseable lines to `backtest/output/unparsed.log` for review |
| Unit conversions don't exist for niche ingredients | Task 2.4 flags these; Task 6.6 sub-assertion 5 explicitly tests the graceful-warning path |
| `?backtest=1` flag leaks to prod | Flag lives ONLY in `backtest/app-fork/` — prod `firebase/public/index.html` never modified. Even if the fork leaked, hostname+port guard (5055 only) + banner catch it. |
| Accidental edit of prod file during task execution | `preflight.sh` runs before every commit and at `run-all.sh` entry/exit — any diff outside `backtest/` + `docs/plans/` aborts. Isolation branch `backtest/harness` never merges without human review. |
| Emulator accidentally points at real Firebase project | `--project restaurant-oracle-backtest` (non-existent in console) + `GOOGLE_APPLICATION_CREDENTIALS=""` + `127.0.0.1`-only binding. Any deploy attempt fails with "project not found". |
| Fork drifts from prod over time | `resync-fork.sh` rebuilds fork from scratch + re-applies `patches/*.patch`. Patch fails loudly if prod moved incompatibly — force a human rebase. |
| 1k recipes slow down UI | Expected; if render time > 2s, paginate in the Recipes tab render (stretch goal, not blocking) |
| Emulator + auth disagreements | Use local-only stub user when `isBacktestMode()` — no real OAuth round-trip |

---

## Deliverables checklist

- [ ] `backtest/` directory with full pipeline + harness
- [ ] 1,000 real recipes imported from RecipeNLG, license documented
- [ ] ~300 canonical ingredients with deduped names
- [ ] Per-ingredient unit conversions for common staples (density + count)
- [ ] 7 mock storage areas with realistic sub-areas
- [ ] Inventory with intentional cross-unit variation (25%+ unit mismatch)
- [ ] 120 preps with realistic on-hand distribution
- [ ] 60 menu items including sub-recipe chains + 3-way unit mismatches
- [ ] Dev-only `?backtest=1` flag lives ONLY in `backtest/app-fork/` (prod `firebase/public/` untouched; preflight enforces)
- [ ] Isolation branch `backtest/harness` with every task commit passing `preflight.sh`
- [ ] Emulator uses `--project restaurant-oracle-backtest` on 127.0.0.1:5055 (never collides with prod)
- [ ] 8 tab interconnectivity Playwright specs passing
- [ ] 6 unit-math invariants (round-trip, scaling, zero-guard) passing
- [ ] 9 shopping-list scenario assertions passing
- [ ] `./backtest/bin/run-all.sh` green in one shot
- [ ] `REPORT.md` with pass/fail + conversion-accuracy histogram
