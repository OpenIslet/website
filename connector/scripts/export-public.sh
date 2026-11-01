#!/bin/bash
# Puts the rights-aware public files of the blueprint repository into ./export, for `npm run bundle`. It only READS the repository.
#
# The blueprint repository comes in two forms, and this handles both:
#   - the full working repository: it uses the repository's own export_public_bundle(), which applies the allowlist in
#     manifest.json and the per-article quote cap, and leaves out the source-text cache (data/dossiers);
#   - a public copy, such as a plain clone of openislet/openislet: that already IS the export, marked with a
#     .openislet_public_bundle file. It is copied as it is, without Git's folder and Python's caches. Exporting it a second time
#     would redact and seal it again and change its manifest, and then the website's numbers would no longer match it.
# Either way the result is checked by the same verifier `npm run bundle` uses.
#
# Override the repository's location with OPENISLET_REPO=/path/to/OpenIslet, and (for tests) where the export goes with
# OPENISLET_EXPORT_DEST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${OPENISLET_REPO:-$(cd "$HERE/../.." && pwd)/OpenIslet}"
DEST="${OPENISLET_EXPORT_DEST:-$HERE/export}"
if [ ! -f "$REPO/scripts/generate_release_manifest.py" ]; then
  echo "Science repo not found at $REPO. Set OPENISLET_REPO." >&2
  exit 1
fi

if [ -f "$REPO/.openislet_public_bundle" ]; then
  INCOMING="$(dirname "$DEST")/.$(basename "$DEST").incoming"
  python3 - "$REPO" "$INCOMING" "$DEST" <<'PY'
import pathlib
import shutil
import sys

src, incoming, dest = (pathlib.Path(a).resolve() for a in sys.argv[1:4])
for other in (incoming, dest):
    if src == other or src in other.parents or other in src.parents:
        sys.exit(f"{src} and {other} overlap: choose another place for the export.")
leave_out = {'.git', '__pycache__', '.pytest_cache', '.DS_Store'}
if incoming.exists():
    shutil.rmtree(incoming)
shutil.copytree(src, incoming, ignore=lambda _dir, names: [n for n in names if n in leave_out or n.endswith('.pyc')], symlinks=True)
PY
  if ! node "$HERE/scripts/verify-export.mjs" "$INCOMING"; then
    rm -rf "$INCOMING"
    echo "$REPO is marked as a public copy, but it does not verify. Use a clean checkout of the public blueprint repository." >&2
    exit 1
  fi
  rm -rf "$DEST"
  mv "$INCOMING" "$DEST"
  echo "Copied the verified public snapshot of $REPO to $DEST, as it is"
else
  python3 - "$REPO" "$DEST" <<'PY'
import importlib.util
import pathlib
import sys

repo = pathlib.Path(sys.argv[1])
dest = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("generate_release_manifest", repo / "scripts" / "generate_release_manifest.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)  # importing does not run anything: main() is guarded
files = module.export_public_bundle(dest)
print(f"Exported {len(files)} allowlisted files to {dest}")
PY
  node "$HERE/scripts/verify-export.mjs" "$DEST"
fi
