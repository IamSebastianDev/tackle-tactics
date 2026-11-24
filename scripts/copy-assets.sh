#!/bin/sh
# Copies the subset of the purchased asset packs the game uses into public/assets.
# Source packs live in ./assets and are NOT redistributable on their own (see their licenses).
set -e
cd "$(dirname "$0")/.."
SRC="assets/Soccer_Match_-_Top_Down_Football_Tileset_&_Players_[32x32]/64"
DST="public/assets"
rm -rf "$DST" && mkdir -p "$DST/cast" "$DST/props" "$DST/tiles"
for d in "$SRC"/animations/cast/*_player_* "$SRC"/animations/cast/keeper_* "$SRC"/animations/cast/coach "$SRC"/animations/cast/coach_2; do
  n=$(basename "$d"); mkdir -p "$DST/cast/$n"; cp "$d"/*.png "$DST/cast/$n/"
done
cp "$SRC"/props/goals/goal_left.png "$SRC"/props/goals/goal_right.png "$SRC"/props/pitch/ball_classic.png "$SRC"/props/pitch/ball_shadow.png "$SRC"/props/pitch/corner_flag_checked.png "$DST/props/"
for t in 001 003 006 008 015 016; do cp "$SRC/tiles/singles/tiles_grass/tiles_grass_$t.png" "$DST/tiles/grass_$t.png"; done
mkdir -p "$DST/fx"
cp "$SRC"/animations/objects/goals/goal_left_net_billow.png "$SRC"/animations/objects/goals/goal_right_net_billow.png "$DST/fx/"
cp "$SRC"/props/trophies/*.png "$DST/props/"
mkdir -p "$DST/stadium"
cp "$SRC"/animations/objects/crowd/fans_*.png "$SRC"/props/crowd/seats_empty_*.png "$DST/stadium/"
cp "$SRC"/props/pitch/ad_board_*.png "$SRC"/props/pitch/floodlight_*.png "$SRC"/props/pitch/dugout_*.png "$SRC"/props/pitch/tv_camera.png "$SRC"/props/pitch/scoreboard.png "$DST/stadium/"
for f in led_board_1 led_board_2 led_board_3 corner_flag_red corner_flag_yellow corner_flag_checked; do cp "$SRC/animations/objects/pitch/$f.png" "$DST/stadium/anim_$f.png"; done
for t in 009 010 011 012 013 014; do cp "$SRC/tiles/singles/tiles_grass/tiles_grass_$t.png" "$DST/tiles/grass_$t.png"; done
echo "assets copied"
