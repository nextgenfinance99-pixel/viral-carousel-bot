#!/bin/sh
set -e

# Persist drafts and rendered videos on the mounted Render disk so they survive
# restarts/redeploys. Reels are drawn entirely from the brand template, so there
# are no uploaded host images or intro config to seed any more — and any left on
# the disk from an older deploy are removed here so they can never be picked up.
PERSIST="${PERSIST_DIR:-/var/data}"
mkdir -p "$PERSIST/assets" "$PERSIST/data" "$PERSIST/temp"
rm -rf "$PERSIST/assets/avatars" "$PERSIST/assets/intro.json"

# Point the app's working dirs at the persistent disk.
rm -rf assets data temp
ln -sfn "$PERSIST/assets" assets
ln -sfn "$PERSIST/data" data
ln -sfn "$PERSIST/temp" temp

exec node server.js
