#!/bin/sh
# Statuszeile für Claude Code: schreibt den Abo-Verbrauch (5 Stunden, Woche) für die herdr App in eine Datei
# und gibt selbst nichts aus, die Statuszeile im Terminal bleibt also leer.
# Eingetragen in ~/.claude/settings.json als statusLine. Ziel: ~/.config/herdr-app/usage.json (600).
dir="${HERDR_APP_STATE:-$HOME/.config/herdr-app}"
in=$(cat 2>/dev/null) || exit 0
rl=$(printf '%s' "$in" | jq -c '.rate_limits // empty' 2>/dev/null) || exit 0
[ -n "$rl" ] || exit 0
mkdir -p "$dir" 2>/dev/null && chmod 700 "$dir" 2>/dev/null
tmp="$dir/.usage.$$"
umask 077
printf '{"at":%s,"rate_limits":%s}\n' "$(date +%s)" "$rl" > "$tmp" && mv -f "$tmp" "$dir/usage.json"
exit 0
