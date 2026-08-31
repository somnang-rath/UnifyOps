#!/usr/bin/env bash
# PostToolUse guardrail: catch design-token violations the moment a file is written.
# Deterministic grep, not judgment. Exit 2 = report to Claude; exit 0 = silent pass.

payload=$(cat)
file=$(printf '%s' "$payload" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//; s/\\/\//g')

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *src/app/globals.css) exit 0 ;;          # layer 1+2 live here; hex is correct
  *.tsx|*.ts|*.css) ;;
  *) exit 0 ;;
esac

findings=""
add() { findings="${findings}  - $1"$'\n'; }

# Literal hex outside the token file.
hex=$(grep -nE '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b' "$file" | grep -vE '^\s*[0-9]+:\s*(//|/\*|\*)' | head -5)
[ -n "$hex" ] && add "literal hex — use a semantic utility (bg-surface, text-muted, border-border):"$'\n'"$(printf '%s' "$hex" | sed 's/^/      /')"

# Layer-1 ramp utilities reached directly from a component.
ramp=$(grep -nE '\b(bg|text|border|ring|fill|stroke|from|to|via)-(sky|navy|ink|crimson|lilac|chartreuse)-[0-9]{2,3}\b' "$file" | head -5)
[ -n "$ramp" ] && add "raw ramp utility — layer 1 is for layer 2 only, components use semantic tokens:"$'\n'"$(printf '%s' "$ramp" | sed 's/^/      /')"

# Tailwind default palette / absolutes: no dark-mode counterpart exists.
dflt=$(grep -nE '\b(bg|text|border)-(white|black|gray|slate|zinc|neutral|stone|blue|red|green|yellow|amber|emerald)(-[0-9]{2,3})?\b' "$file" | head -5)
[ -n "$dflt" ] && add "default-palette or absolute colour — hard-codes light mode:"$'\n'"$(printf '%s' "$dflt" | sed 's/^/      /')"

# Focus rings are global; removing one is never right here.
out=$(grep -nE 'outline:\s*none|outline-none' "$file" | head -3)
[ -n "$out" ] && add "outline removed — :focus-visible is handled globally in globals.css:"$'\n'"$(printf '%s' "$out" | sed 's/^/      /')"

# Character slicing breaks Khmer grapheme clusters.
slice=$(grep -nE '\.(slice|substring|substr)\(' "$file" | grep -viE 'array|\[\]|items|rows|list|graphemes|segments' | head -3)
[ -n "$slice" ] && add "string slicing — if this is user-visible text, truncate with Intl.Segmenter (Khmer graphemes):"$'\n'"$(printf '%s' "$slice" | sed 's/^/      /')"

if [ -n "$findings" ]; then
  printf 'Design-token check on %s\n%s\nSee .claude/skills/design-tokens/SKILL.md. Fix these before moving on.\n' "$file" "$findings" >&2
  exit 2
fi
exit 0
