#!/usr/bin/env python3
"""
Reads the science repo's own Idea Graveyard engine (scripts/rank_islet1_stacks.py), read-only.

  python3 scripts/golden-graveyard.py                  records what the engine says for every design
                                                        in tests/golden/graveyard-grid.json, so the TypeScript port in
                                                        src/core/graveyard.ts can be proved equal
  python3 scripts/golden-graveyard.py --modules-only   prints the design modules as JSON (used by the bundle builder)
  python3 scripts/golden-graveyard.py --repo PATH      read another checkout (default: connector/export, the public export)

Python bytecode is not written, so nothing is added to the folder that is read.
"""
import argparse
import json
import pathlib
import sys
from itertools import product

sys.dont_write_bytecode = True

here = pathlib.Path(__file__).resolve().parent
connector = here.parent

parser = argparse.ArgumentParser()
parser.add_argument("--repo", default=str(connector / "export"))
parser.add_argument("--modules-only", action="store_true")
parser.add_argument("--out", default=str(connector / "tests" / "golden" / "graveyard-grid.json"))
args = parser.parse_args()

repo = pathlib.Path(args.repo).resolve()
sys.path.insert(0, str(repo / "scripts"))
import rank_islet1_stacks as r  # noqa: E402  (importing runs nothing: the script's main is guarded)

axes = {
    "allo": r.ALLO_CLOAK_MODULES,
    "autoantigen": r.AUTOANTIGEN_MODULES,
    "cytokine": r.CYTOKINE_GRANZYME_MODULES,
    "er_stress": r.ER_AMYLOID_MODULES,
    "niche": r.NICHE_VASCULAR_MODULES,
    "safety": r.SAFETY_SWITCH_MODULES,
}

modules = {}
for axis, table in axes.items():
    for module_id, spec in table.items():
        modules[module_id] = {
            "axis": axis,
            "label": spec["label"],
            "cuts": spec["cuts"],
            "base_edits": spec["base_edits"],
            "genes": spec["genes"],
            "description": spec["description"],
        }

axis_ids = {axis: list(table.keys()) for axis, table in axes.items()}

if args.modules_only:
    json.dump({"axes": axis_ids, "modules": modules}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0)

combos = []
for ids in product(*axis_ids.values()):
    allo, auto, cyto, er, niche, saf = ids
    total_b = sum(modules[i]["base_edits"] for i in ids)
    total_k = sum(modules[i]["cuts"] for i in ids)
    triggered = r.evaluate_graveyard_rules_for_stack(allo, auto, cyto, er, niche, saf, total_b)
    combos.append({"ids": list(ids), "total_b": total_b, "total_k": total_k, "triggered": triggered})

out = {
    "source": "scripts/rank_islet1_stacks.py in the science repo (public export)",
    "axes": axis_ids,
    "modules": modules,
    "combos": combos,
}
dest = pathlib.Path(args.out)
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
blocked = sum(1 for c in combos if any(t["severity_level"] == "BLOCK" for t in c["triggered"]))
print(f"wrote {dest} with {len(combos)} designs ({blocked} blocked) and {len(modules)} modules")
