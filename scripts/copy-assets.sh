#!/bin/sh
# The licensed source sheets stay in assets. The exporter puts the processed art in public/assets.
set -e
cd "$(dirname "$0")/.."
exec python3 scripts/export-art.py
