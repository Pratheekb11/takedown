#!/usr/bin/env bash
# Deploy Take Down to production: refresh the service worker's file list and version
# (so players pick up the new build), then push the site to Vercel.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/build_sw.py
npx vercel deploy --prod --yes
