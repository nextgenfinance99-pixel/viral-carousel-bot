#!/bin/sh
set -e

# Persist uploads (host/avatar images + intro.json), drafts, and rendered videos
# on the mounted Render disk so they survive restarts/redeploys.
PERSIST="${PERSIST_DIR:-/var/data}"
mkdir -p "$PERSIST/assets" "$PERSIST/data" "$PERSIST/temp"

# Seed the persistent assets dir with repo defaults (intro.json, README) once.
if [ ! -f "$PERSIST/assets/intro.json" ]; then
  cp -r assets/. "$PERSIST/assets/" 2>/dev/null || true
fi

# Point the app's working dirs at the persistent disk.
rm -rf assets data temp
ln -sfn "$PERSIST/assets" assets
ln -sfn "$PERSIST/data" data
ln -sfn "$PERSIST/temp" temp

exec node server.js
