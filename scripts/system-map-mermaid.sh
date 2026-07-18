#!/usr/bin/env bash
# system-map-mermaid.sh
#
# Test bench: generate a mermaid diagram of installed Debian/Ubuntu packages
# using the SAME prompt pipeline as prompts/smart/ (stage2 + mermaid).
#
# What it does (no code changes to the app):
#   1. Collect an APT snapshot (manual/auto/autoremove, dpkg list, sizes, sections).
#   2. Package it as a synthetic "stage1 research assistant message".
#   3. Call the LLM with prompts/smart/system.md + prompts/smart/stage2.md
#      to obtain a CODEMAP JSON where each location = package.
#   4. Call the LLM again with prompts/smart/mermaid.md to render a mermaid graph.
#   5. Save everything under out/system-map/.
#
# Uses:
#   - ~/.cometix/codemap/settings.json  (openaiApiKey, openaiBaseUrl, model, language)
#   - prompts/smart/{system,stage2,mermaid}.md
#
# No dependencies beyond: bash, curl, jq, python3, dpkg-query, apt-mark,
# apt-cache, apt-get (simulated autoremove).
#
# Usage:
#   scripts/system-map-mermaid.sh "Что установлено, что не используется"
#   MAX_PACKAGES=250 scripts/system-map-mermaid.sh "..."

set -euo pipefail

# ---------- paths ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPTS_DIR="$REPO_ROOT/prompts/smart"
OUT_DIR="$REPO_ROOT/out/system-map"
SETTINGS_FILE="${SETTINGS_FILE:-$HOME/.cometix/codemap/settings.json}"

mkdir -p "$OUT_DIR"

# ---------- args ----------
QUERY="${1:-Карта установленных пакетов Ubuntu: домены, зависимые группы и неиспользуемые (autoremove) пакеты}"
MAX_PACKAGES="${MAX_PACKAGES:-260}"       # keep prompt size sane; top-N by size
MAX_MANUAL="${MAX_MANUAL:-160}"           # manual roots are usually < 200
MAX_AUTOREMOVE="${MAX_AUTOREMOVE:-80}"

# ---------- checks ----------
for bin in curl jq python3 dpkg-query apt-mark apt-cache apt-get lsmod systemctl; do
  command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }
done
[[ -r "$SETTINGS_FILE" ]] || { echo "no settings file: $SETTINGS_FILE" >&2; exit 1; }
[[ -d "$PROMPTS_DIR"   ]] || { echo "no prompts dir: $PROMPTS_DIR"   >&2; exit 1; }

API_KEY="$(jq -r '.openaiApiKey // ""' "$SETTINGS_FILE")"
BASE_URL="$(jq -r '.openaiBaseUrl // "https://api.openai.com/v1"' "$SETTINGS_FILE")"
MODEL="$(jq -r '.model // "deepseek-chat"' "$SETTINGS_FILE")"
LANGUAGE="$(jq -r '.language // "Russian"' "$SETTINGS_FILE")"
[[ -n "$API_KEY" && "$API_KEY" != "null" ]] || { echo "openaiApiKey missing in $SETTINGS_FILE" >&2; exit 1; }

echo "[system-map] model=$MODEL base=$BASE_URL lang=$LANGUAGE" >&2

# ---------- 1. APT snapshot ----------
SNAPSHOT_JSON="$OUT_DIR/apt-snapshot.json"
SNAPSHOT_TXT="$OUT_DIR/apt-snapshot.txt"

echo "[system-map] collecting APT snapshot..." >&2

MANUAL_LIST="$(apt-mark showmanual 2>/dev/null | sort -u)"
AUTO_LIST="$(apt-mark showauto   2>/dev/null | sort -u)"
AUTOREMOVE_LIST="$(apt-get -s autoremove 2>/dev/null \
  | awk '/^Remv /{print $2}' | sort -u || true)"

# All installed packages with size + section + priority.
# Installed-Size is in KB; convert to bytes for JSON, MB for text.
DPKG_TSV="$OUT_DIR/dpkg-installed.tsv"
dpkg-query -W \
  -f='${Package}\t${Version}\t${Installed-Size}\t${Priority}\t${Section}\t${binary:Summary}\n' \
  > "$DPKG_TSV"

python3 - "$DPKG_TSV" "$MANUAL_LIST" "$AUTO_LIST" "$AUTOREMOVE_LIST" \
              "$MAX_PACKAGES" "$MAX_MANUAL" "$MAX_AUTOREMOVE" \
              "$SNAPSHOT_JSON" "$SNAPSHOT_TXT" <<'PY'
import json, sys, collections, pathlib

(tsv, manual, auto, autoremove,
 max_pkg, max_man, max_arm,
 out_json, out_txt) = sys.argv[1:]

def as_set(text):
    return {line.strip() for line in text.splitlines() if line.strip()}

manual_set     = as_set(manual)
auto_set       = as_set(auto)
autoremove_set = as_set(autoremove)

pkgs = []
by_section = collections.Counter()
with open(tsv, encoding="utf-8", errors="replace") as fh:
    for raw in fh:
        parts = raw.rstrip("\n").split("\t")
        while len(parts) < 6:
            parts.append("")
        name, version, size_kb, priority, section, summary = parts[:6]
        if not name:
            continue
        try:
            size = int(size_kb) * 1024
        except ValueError:
            size = 0
        status = ("autoremove" if name in autoremove_set
                  else "manual" if name in manual_set
                  else "auto"   if name in auto_set
                  else "installed")
        pkgs.append({
            "name": name, "version": version, "size": size,
            "priority": priority, "section": section,
            "status": status, "summary": summary,
        })
        by_section[section or "?"] += 1

pkgs.sort(key=lambda p: -p["size"])

manual_pkgs     = [p for p in pkgs if p["status"] == "manual"][:int(max_man)]
autoremove_pkgs = [p for p in pkgs if p["status"] == "autoremove"][:int(max_arm)]
top_pkgs        = pkgs[:int(max_pkg)]

# Merge: manual + autoremove always included, then fill up to max_pkg from top by size.
seen, merged = set(), []
for group in (manual_pkgs, autoremove_pkgs, top_pkgs):
    for p in group:
        if p["name"] in seen: continue
        seen.add(p["name"]); merged.append(p)

snapshot = {
    "total_installed": len(pkgs),
    "manual_count":     sum(1 for p in pkgs if p["status"] == "manual"),
    "auto_count":       sum(1 for p in pkgs if p["status"] == "auto"),
    "autoremove_count": sum(1 for p in pkgs if p["status"] == "autoremove"),
    "top_sections":     by_section.most_common(20),
    "packages":         merged,
    "autoremove":       [p["name"] for p in pkgs if p["status"] == "autoremove"],
    "manual":           [p["name"] for p in pkgs if p["status"] == "manual"],
}
pathlib.Path(out_json).write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))

def mb(n): return f"{n/1_048_576:.1f}MB"

lines = []
lines.append(f"# APT snapshot")
lines.append(f"total_installed: {snapshot['total_installed']}")
lines.append(f"manual: {snapshot['manual_count']}  auto: {snapshot['auto_count']}"
             f"  autoremove: {snapshot['autoremove_count']}")
lines.append("")
lines.append("## Sections (top 20)")
for name, count in snapshot["top_sections"]:
    lines.append(f"- {name}: {count}")
lines.append("")
lines.append("## Autoremove candidates (unused)")
for name in snapshot["autoremove"] or ["<none>"]:
    lines.append(f"- {name}")
lines.append("")
lines.append("## Manual roots")
for p in manual_pkgs:
    lines.append(f"- {p['name']}  {p['version']}  {mb(p['size'])}  [{p['section']}]  {p['summary']}")
lines.append("")
lines.append("## Packages by size (top)")
for p in merged:
    tag = p["status"]
    lines.append(f"- [{tag}] {p['name']}  {p['version']}  {mb(p['size'])}  [{p['section']}]  {p['summary']}")
pathlib.Path(out_txt).write_text("\n".join(lines))
PY

echo "[system-map] snapshot:" \
     "$(jq '.total_installed, .manual_count, .auto_count, .autoremove_count' "$SNAPSHOT_JSON" | tr '\n' ' ')" >&2

# ---------- 1b. system-map runtime enrichment ----------
# Collect the low-cost, no-root signals needed for DDD-style node manifests:
#   - lsmod   → currently loaded kernel modules (kmod:*)
#   - systemctl list-unit-files → available *.service units (systemd methods)
#   - apt-cache show for the packages that end up in the stage2 codemap
#     (deps/binaries/conffiles)  — bounded to keep the prompt sane.

RUNTIME_TXT="$OUT_DIR/runtime-snapshot.txt"
RUNTIME_JSON="$OUT_DIR/runtime-snapshot.json"
LSMOD_RAW="$OUT_DIR/_lsmod.raw"
UNITS_RAW="$OUT_DIR/_units.raw"
APTCACHE_RAW="$OUT_DIR/_aptcache.raw"

# lsmod: Name Size Used-count Used-by
lsmod 2>/dev/null | tail -n +2 > "$LSMOD_RAW" || : > "$LSMOD_RAW"

# systemd unit files (name  state) — services only, disabled/enabled/masked/…
systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null \
  > "$UNITS_RAW" || : > "$UNITS_RAW"

# apt-cache show for the packages in the merged snapshot (bounded).
: > "$APTCACHE_RAW"
APTCACHE_MAX="${APTCACHE_MAX:-120}"
jq -r ".packages[].name" "$SNAPSHOT_JSON" | head -n "$APTCACHE_MAX" \
  | while read -r pkg; do
      [[ -z "$pkg" ]] && continue
      # Only fetch the fields we will actually use downstream.
      apt-cache show "$pkg" 2>/dev/null \
        | awk 'BEGIN{p=0}
               /^Package: /{p=1}
               p && /^(Package|Section|Priority|Installed-Size|Depends|Pre-Depends|Recommends|Provides|Conffiles|Description-en|Description): /{print}
               /^$/ && p {print ""; p=0}' \
        | head -n 60 \
        >> "$APTCACHE_RAW"
    done

python3 - "$LSMOD_RAW" "$UNITS_RAW" "$APTCACHE_RAW" \
              "$RUNTIME_JSON" "$RUNTIME_TXT" <<'PY'
import json, sys, pathlib, re, collections

(lsmod_path, units_path, aptcache_path,
 out_json, out_txt) = sys.argv[1:]

def read(p):
    try: return pathlib.Path(p).read_text(encoding="utf-8", errors="replace")
    except Exception: return ""

# --- lsmod ---
kmods = []
for line in read(lsmod_path).splitlines():
    parts = line.split()
    if len(parts) < 2: continue
    name, size = parts[0], parts[1]
    used_by = parts[3] if len(parts) >= 4 else ""
    try: size_i = int(size)
    except ValueError: size_i = 0
    kmods.append({
        "name":    name,
        "size":    size_i,
        "used_by": [u for u in used_by.split(",") if u and u != "-"],
    })

# --- systemd unit files (only *.service) ---
units = []
for line in read(units_path).splitlines():
    parts = re.split(r"\s+", line.strip())
    if len(parts) < 2: continue
    name, state = parts[0], parts[1]
    if not name.endswith(".service"): continue
    units.append({"name": name, "state": state})

# --- apt-cache show parsing (blocks separated by blank line) ---
packages = {}
current = {}
for line in read(aptcache_path).splitlines():
    if not line.strip():
        if current.get("Package"):
            name = current["Package"]
            # Prefer the first (usually richest) block per package.
            packages.setdefault(name, current)
        current = {}
        continue
    m = re.match(r"^([A-Za-z][\w-]+): (.*)$", line)
    if m:
        current[m.group(1)] = m.group(2)

def split_dep(field):
    if not field: return []
    # "libc6 (>= 2.34), libglib2.0-0 | libglib2.0-0t64, …"
    out = []
    for chunk in field.split(","):
        chunk = chunk.strip()
        if not chunk: continue
        # take the first alternative only, strip version constraint
        first = chunk.split("|")[0].strip()
        name = re.split(r"[\s(]", first, 1)[0]
        if name: out.append(name)
    # de-dup preserving order
    seen, uniq = set(), []
    for n in out:
        if n in seen: continue
        seen.add(n); uniq.append(n)
    return uniq

pkg_meta = {}
for name, blk in packages.items():
    pkg_meta[name] = {
        "section":     blk.get("Section", ""),
        "priority":    blk.get("Priority", ""),
        "installed_size_kb": int(blk.get("Installed-Size") or 0) if (blk.get("Installed-Size") or "").isdigit() else 0,
        "depends":     split_dep(blk.get("Depends", "")),
        "pre_depends": split_dep(blk.get("Pre-Depends", "")),
        "recommends":  split_dep(blk.get("Recommends", "")),
        "provides":    split_dep(blk.get("Provides", "")),
        # Description: keep first line only (already the short summary).
        "description": (blk.get("Description-en") or blk.get("Description") or "").splitlines()[0][:200],
    }

runtime = {
    "lsmod":    kmods,
    "units":    units,
    "packages": pkg_meta,
}
pathlib.Path(out_json).write_text(json.dumps(runtime, ensure_ascii=False, indent=2))

# Human/LLM-readable digest (kept small: this goes into the prompt).
lines = []
lines.append("# Runtime snapshot")
lines.append(f"loaded_kernel_modules: {len(kmods)}")
lines.append(f"service_units: {len(units)}")
lines.append(f"apt_cache_packages: {len(pkg_meta)}")
lines.append("")
lines.append("## Loaded kernel modules (lsmod)")
for m in kmods[:120]:
    used = ", ".join(m["used_by"][:6]) or "-"
    lines.append(f"- kmod:{m['name']}  size={m['size']}  used_by=[{used}]")
lines.append("")
lines.append("## Systemd service unit files (state)")
# keep enabled/static/masked first — those are the "real" methods
priority = {"enabled": 0, "enabled-runtime": 0, "static": 1, "alias": 2,
            "masked": 3, "disabled": 4, "indirect": 5}
units_sorted = sorted(units, key=lambda u: (priority.get(u["state"], 9), u["name"]))
for u in units_sorted[:200]:
    lines.append(f"- {u['name']}  [{u['state']}]")
lines.append("")
lines.append("## apt-cache show (bounded)")
for name, meta in list(pkg_meta.items())[:200]:
    deps = ", ".join((meta["pre_depends"] + meta["depends"])[:8]) or "-"
    prov = ", ".join(meta["provides"][:4]) or "-"
    lines.append(
        f"- pkg:{name}  section={meta['section']}  size={meta['installed_size_kb']}KB\n"
        f"    depends: {deps}\n"
        f"    provides: {prov}\n"
        f"    desc: {meta['description']}"
    )
pathlib.Path(out_txt).write_text("\n".join(lines))
PY

echo "[system-map] runtime snapshot: kmods=$(jq '.lsmod|length' "$RUNTIME_JSON") units=$(jq '.units|length' "$RUNTIME_JSON") apt-cache=$(jq '.packages|length' "$RUNTIME_JSON")" >&2

# ---------- 2. prompts ----------
CUR_DATE="$(date '+%b %-d, %Y at %-I:%M%p, %Z')"
WS_LAYOUT="$(head -c 2000 "$SNAPSHOT_TXT")"

# Strip leading markdown H1 like prompts.js loadCachedFile does.
strip_h1() { sed -E '1{/^#[^\n]*/d}' "$1"; }

SYSTEM_RAW="$(strip_h1 "$PROMPTS_DIR/system.md")"
STAGE2_RAW="$(strip_h1 "$PROMPTS_DIR/stage2.md")"
MERMAID_RAW="$(strip_h1 "$PROMPTS_DIR/mermaid.md")"

# {{ var }} substitution helper (Python for safety with special chars).
substitute() {
  local template="$1"; shift
  python3 - "$template" "$@" <<'PY'
import re, sys
template = sys.argv[1]
kv = {sys.argv[i]: sys.argv[i+1] for i in range(2, len(sys.argv), 2)}
def repl(m):
    key = m.group(1).strip()
    return kv.get(key, m.group(0))
print(re.sub(r"\{\{\s*(\w+)\s*\}\}", repl, template), end="")
PY
}

SYSTEM_PROMPT="$(substitute "$SYSTEM_RAW" \
  user_os "linux" \
  workspace_uri "system://apt/$(hostname)" \
  corpus_name "apt-installed" \
  workspace_layout "$WS_LAYOUT" \
  current_date "$CUR_DATE")"

# System-map addendum: reinterpret "code" as "installed packages".
SYSTEM_PROMPT+="

<system_map_addendum>
In this session the 'codebase' is the set of installed Debian/Ubuntu packages on the user's machine.
Each package plays the role of a file. Treat these mappings as strict:
- trace = functional domain (Desktop, Networking, Dev toolchain, Multimedia, Kernel/boot, Snap, Fonts, System libs, Unused/autoremove ...).
- location.path       = package name (e.g. \"pkg://gnome-shell\")
- location.lineNumber = 0
- location.lineContent = short package summary (<= 80 chars)
- location.title       = package name
- location.description = role of the package + one of [manual | auto | autoremove], keep <= 100 chars
- One dedicated trace MUST be titled 'Unused (autoremove)' and contain only packages from the autoremove list.
- Do NOT invent packages that are not in the snapshot below.
- Respond in ${LANGUAGE}.

Size budget (hard limits, the response must fit into ~8000 tokens):
- Total traces: 6-9.
- Locations per trace: 3-6.
- Keep descriptions short. Do NOT use markdown code fences inside the JSON.
- Output ONLY the tags <PLAN>...</PLAN><CODEMAP>...</CODEMAP>. No prose outside the tags.
- The CODEMAP JSON must be valid and complete. Prefer fewer traces over truncation.
</system_map_addendum>
"

STAGE1_QUERY_MSG="Explore the installed packages to answer:
<user_prompt>${QUERY}</user_prompt>
The 'workspace' is the APT snapshot below. Use it as ground truth; do not invent packages."

STAGE1_RESEARCH_MSG="I am done researching. 1 sentence summary: analyzed the APT snapshot ($(jq -r .total_installed "$SNAPSHOT_JSON") installed packages, $(jq -r .manual_count "$SNAPSHOT_JSON") manual roots, $(jq -r .autoremove_count "$SNAPSHOT_JSON") autoremove candidates) and grouped packages by functional domain, dependency status and unused set.

<APT_SNAPSHOT>
$(cat "$SNAPSHOT_TXT")
</APT_SNAPSHOT>
"

STAGE2_USER="$(substitute "$STAGE2_RAW" current_date "$CUR_DATE")"
MERMAID_USER="$(substitute "$MERMAID_RAW" current_date "$CUR_DATE")"

# ---------- 3. LLM call helper ----------
call_llm() {
  local payload_file="$1" out_file="$2"
  local http_code
  # --max-time is generous: on this proxy nginx idle timeout kills long reasoning
  # responses, so we also send reasoning_effort=minimal in the payload.
  http_code=$(curl -sS --max-time "${LLM_MAX_TIME:-300}" \
    -o "$out_file.raw" -w '%{http_code}' \
    -X POST "$BASE_URL/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $API_KEY" \
    --data @"$payload_file")
  if [[ "$http_code" != "200" ]]; then
    echo "[system-map] LLM HTTP $http_code" >&2
    cat "$out_file.raw" >&2
    exit 1
  fi
  jq -r '.choices[0].message.content // empty' "$out_file.raw" > "$out_file"
  [[ -s "$out_file" ]] || { echo "[system-map] empty LLM response" >&2; exit 1; }
}

build_payload() {
  # Args: out_file, then pairs of  role  content_file
  local out="$1"; shift
  # REASONING_EFFORT is only meaningful for gpt-5.x-style reasoning models.
  # DeepSeek / plain chat models reject the field, so default to empty and
  # do NOT let a stray shell export leak in.
  env -u REASONING_EFFORT \
    REASONING_EFFORT="${REASONING_EFFORT:-}" \
    LLM_MAX_TOKENS="${LLM_MAX_TOKENS:-8000}" \
    LLM_TEMPERATURE="${LLM_TEMPERATURE:-0.2}" \
    python3 - "$MODEL" "$out" "$@" <<'PY'
import json, os, sys
model, out, *rest = sys.argv[1:]
messages = []
for i in range(0, len(rest), 2):
    role, path = rest[i], rest[i+1]
    with open(path, encoding="utf-8") as fh:
        messages.append({"role": role, "content": fh.read()})
payload = {
    "model": model,
    "messages": messages,
    "temperature": float(os.environ.get("LLM_TEMPERATURE") or 0.2),
    "max_tokens": int(os.environ.get("LLM_MAX_TOKENS") or 8000),
}
# gpt-5.x on the local proxy defaults to a reasoning mode that easily hits the
# nginx 504 timeout on big prompts. "minimal" turns it into a plain chat model.
# DeepSeek rejects the field entirely, so only emit when explicitly requested.
effort = (os.environ.get("REASONING_EFFORT") or "").strip()
if effort:
    payload["reasoning_effort"] = effort
with open(out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False)
PY
}

# ---------- 4. Stage 2: CODEMAP ----------
echo "[system-map] stage2: codemap..." >&2
S_SYS="$OUT_DIR/_msg.system.txt"
S_U1="$OUT_DIR/_msg.user1.txt"
S_A1="$OUT_DIR/_msg.asst1.txt"
S_U2="$OUT_DIR/_msg.user2.txt"

printf '%s' "$SYSTEM_PROMPT"       > "$S_SYS"
printf '%s' "$STAGE1_QUERY_MSG"    > "$S_U1"
printf '%s' "$STAGE1_RESEARCH_MSG" > "$S_A1"
printf '%s' "$STAGE2_USER"         > "$S_U2"

PAYLOAD2="$OUT_DIR/_payload.stage2.json"
STAGE2_OUT="$OUT_DIR/stage2.response.txt"
build_payload "$PAYLOAD2" \
  system "$S_SYS" \
  user   "$S_U1" \
  assistant "$S_A1" \
  user   "$S_U2"
call_llm "$PAYLOAD2" "$STAGE2_OUT"

# Extract JSON codemap between <CODEMAP>...</CODEMAP> (or fallback). Tolerates
# truncation caused by output-token limits by auto-closing dangling brackets.
CODEMAP_JSON="$OUT_DIR/codemap.json"
python3 - "$STAGE2_OUT" "$CODEMAP_JSON" <<'PY'
import re, sys, json, pathlib

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")

def find_block(t):
    m = re.search(r"<CODEMAP>\s*(.*?)\s*</CODEMAP>", t, re.S)
    if m: return m.group(1)
    m = re.search(r"<CODEMAP>\s*(.*)$", t, re.S)   # unterminated tag
    if m: return m.group(1)
    m = re.search(r"\{[\s\S]*\"traces\"[\s\S]*", t)  # raw JSON tail
    return m.group(0) if m else t

raw = find_block(text).strip()
# Strip ```json fences the model sometimes adds.
raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.M).strip()

def try_load(s):
    try: return json.loads(s)
    except Exception: return None

obj = try_load(raw)
if obj is None:
    # Truncation repair: walk once, track brackets outside strings, close them.
    stack = []
    in_str = False
    esc = False
    last_good = 0
    for i, ch in enumerate(raw):
        if in_str:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': in_str = False
            continue
        if ch == '"': in_str = True
        elif ch in "{[": stack.append(ch)
        elif ch in "}]":
            if stack and ((stack[-1]=="{" and ch=="}") or (stack[-1]=="[" and ch=="]")):
                stack.pop()
            else:
                break
        if ch in "}]" and not stack:
            last_good = i + 1
    # Trim after last complete comma/quote-safe char and close remaining brackets.
    trimmed = raw[:last_good] if last_good else raw
    if not last_good:
        # Backtrack from end to a comma/brace boundary outside strings.
        trimmed = re.sub(r",\s*$", "", raw.rstrip())
        for close in reversed(stack):
            trimmed += "}" if close == "{" else "]"
    obj = try_load(trimmed)
    if obj is None:
        # Last resort: strip trailing partial location object.
        cut = trimmed.rfind("},")
        if cut > 0:
            obj = try_load(trimmed[:cut+1] + "]}]}")

if obj is None:
    sys.stderr.write("cannot extract CODEMAP JSON (even after repair)\n")
    sys.exit(2)

pathlib.Path(sys.argv[2]).write_text(json.dumps(obj, ensure_ascii=False, indent=2))
n = len(obj.get("traces", []))
print(f"traces: {n}")
PY

# ---------- 5. Mermaid stage ----------
echo "[system-map] stage6: mermaid..." >&2
S_A2="$OUT_DIR/_msg.asst2.txt"
S_U3="$OUT_DIR/_msg.user3.txt"

# Feed stage2 assistant reply back as context, then ask for mermaid.
printf '%s' "$(cat "$STAGE2_OUT")" > "$S_A2"
printf '%s' "$MERMAID_USER"        > "$S_U3"

PAYLOAD_M="$OUT_DIR/_payload.mermaid.json"
MERMAID_OUT="$OUT_DIR/mermaid.response.txt"
build_payload "$PAYLOAD_M" \
  system "$S_SYS" \
  user   "$S_U1" \
  assistant "$S_A1" \
  user   "$S_U2" \
  assistant "$S_A2" \
  user   "$S_U3"
call_llm "$PAYLOAD_M" "$MERMAID_OUT"

MERMAID_FILE="$OUT_DIR/system-map.mmd"
python3 - "$MERMAID_OUT" "$MERMAID_FILE" <<'PY'
import re, sys, pathlib
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(r"```mermaid\s*(.*?)\s*```", text, re.S | re.I)
if not m:
    sys.stderr.write("no ```mermaid``` block in response\n"); sys.exit(2)
pathlib.Path(sys.argv[2]).write_text(m.group(1).strip() + "\n")
PY

# ---------- 6. Stage 2b: DDD enrichment (JSON-LD manifests per node) ----------
# Skip when SYSTEM_MAP_SKIP_ENRICH=1 (useful for quick iterations on stage2).
ENRICHED_JSONLD="$OUT_DIR/enriched-nodes.jsonld"
if [[ "${SYSTEM_MAP_SKIP_ENRICH:-0}" == "1" ]]; then
  echo "[system-map] enrichment: skipped (SYSTEM_MAP_SKIP_ENRICH=1)" >&2
else
  echo "[system-map] stage2b: DDD enrichment..." >&2

  STAGE2B_PROMPTS_DIR="$REPO_ROOT/prompts/system-map"
  [[ -r "$STAGE2B_PROMPTS_DIR/stage2b.md" ]] || {
    echo "[system-map] missing $STAGE2B_PROMPTS_DIR/stage2b.md, skipping enrichment" >&2
    ENRICHED_JSONLD=""
  }

  if [[ -n "$ENRICHED_JSONLD" ]]; then
    STAGE2B_RAW="$(strip_h1 "$STAGE2B_PROMPTS_DIR/stage2b.md")"
    STAGE2B_USER="$(substitute "$STAGE2B_RAW" \
      current_date "$CUR_DATE" \
      language     "$LANGUAGE")"

    # Feed the assistant its previously-emitted CODEMAP, then attach the
    # runtime snapshot (lsmod / units / apt-cache) as ground truth.
    S_U4="$OUT_DIR/_msg.user4.txt"
    {
      printf '%s\n' "$STAGE2B_USER"
      printf '\n<CODEMAP_ECHO id="%s">\n' "stage2"
      cat "$CODEMAP_JSON"
      printf '\n</CODEMAP_ECHO>\n'
      printf '\n<SYSTEM_SNAPSHOT>\n'
      printf '\n<APT_SNAPSHOT>\n'
      cat "$SNAPSHOT_TXT"
      printf '\n</APT_SNAPSHOT>\n'
      printf '\n<RUNTIME_SNAPSHOT>\n'
      cat "$RUNTIME_TXT"
      printf '\n</RUNTIME_SNAPSHOT>\n'
      printf '</SYSTEM_SNAPSHOT>\n'
    } > "$S_U4"

    PAYLOAD_E="$OUT_DIR/_payload.enrich.json"
    ENRICH_OUT="$OUT_DIR/enrich.response.txt"
    # This stage tends to be verbose (per-node manifests); bump the token cap.
    LLM_MAX_TOKENS="${LLM_ENRICH_MAX_TOKENS:-14000}" \
      build_payload "$PAYLOAD_E" \
        system "$S_SYS" \
        user   "$S_U1" \
        assistant "$S_A1" \
        user   "$S_U2" \
        assistant "$S_A2" \
        user   "$S_U4"
    call_llm "$PAYLOAD_E" "$ENRICH_OUT"

    python3 - "$ENRICH_OUT" "$ENRICHED_JSONLD" <<'PY'
import re, sys, json, pathlib

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")

def find_block(t):
    m = re.search(r"<ENRICHED>\s*(.*?)\s*</ENRICHED>", t, re.S)
    if m: return m.group(1)
    m = re.search(r"<ENRICHED>\s*(.*)$", t, re.S)  # unterminated
    if m: return m.group(1)
    m = re.search(r"\{[\s\S]*\"@graph\"[\s\S]*", t)
    return m.group(0) if m else t

raw = find_block(text).strip()
raw = re.sub(r"^```(?:json(?:ld)?|jsonld)?\s*|\s*```$", "", raw, flags=re.M).strip()

def try_load(s):
    try: return json.loads(s)
    except Exception: return None

# Same "close dangling brackets" repair used for the CODEMAP block.
obj = try_load(raw)
if obj is None:
    stack, in_str, esc, last_good = [], False, False, 0
    for i, ch in enumerate(raw):
        if in_str:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': in_str = False
            continue
        if ch == '"': in_str = True
        elif ch in "{[": stack.append(ch)
        elif ch in "}]":
            if stack and ((stack[-1]=="{" and ch=="}") or (stack[-1]=="[" and ch=="]")):
                stack.pop()
            else:
                break
        if ch in "}]" and not stack:
            last_good = i + 1
    trimmed = raw[:last_good] if last_good else raw
    if not last_good:
        trimmed = re.sub(r",\s*$", "", raw.rstrip())
        for close in reversed(stack):
            trimmed += "}" if close == "{" else "]"
    obj = try_load(trimmed)
    if obj is None:
        # Try trimming the last (possibly partial) graph node.
        cut = trimmed.rfind("},")
        if cut > 0:
            candidate = trimmed[:cut+1] + "]}"
            obj = try_load(candidate)

if obj is None:
    sys.stderr.write("[stage2b] cannot extract ENRICHED JSON-LD\n")
    sys.exit(2)

# Cross-check against codemap: report how many locations got a manifest.
graph = obj.get("@graph") or []
loc_ids = {n.get("locationId") for n in graph if isinstance(n, dict)}
pathlib.Path(sys.argv[2]).write_text(json.dumps(obj, ensure_ascii=False, indent=2))
print(f"nodes: {len(graph)}  distinct_locationIds: {len([x for x in loc_ids if x])}")
PY

    # Coverage report against the CODEMAP so callers see gaps immediately.
    python3 - "$CODEMAP_JSON" "$ENRICHED_JSONLD" <<'PY' || true
import json, sys, pathlib
codemap = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
enriched = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
have = {n.get("locationId") for n in enriched.get("@graph", []) if isinstance(n, dict)}
missing = []
for tr in codemap.get("traces", []):
    for loc in tr.get("locations", []):
        lid = loc.get("id")
        if lid and lid not in have:
            missing.append(f"{lid} ({loc.get('title')})")
print(f"[stage2b] coverage: {len(have)}/{sum(len(t.get('locations',[])) for t in codemap.get('traces',[]))}", file=sys.stderr)
if missing:
    print(f"[stage2b] missing manifests: {', '.join(missing[:20])}"
          + (" ..." if len(missing) > 20 else ""), file=sys.stderr)
PY
  fi
fi

echo
echo "[system-map] done."
echo "  snapshot : $SNAPSHOT_JSON"
echo "  runtime  : $RUNTIME_JSON"
echo "  codemap  : $CODEMAP_JSON"
echo "  mermaid  : $MERMAID_FILE"
[[ -n "$ENRICHED_JSONLD" && -s "$ENRICHED_JSONLD" ]] && echo "  enriched : $ENRICHED_JSONLD"
echo
echo "Preview mermaid at https://mermaid.live/ or open in the app after fork."
