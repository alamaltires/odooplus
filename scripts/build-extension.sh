#!/bin/sh
# Packs extension/ into public/msrp-finder-helper.zip so the MSRP Finder page can offer it as a download.
set -e
cd "$(dirname "$0")/.."
rm -f public/msrp-finder-helper.zip
(cd extension && zip -qr ../public/msrp-finder-helper.zip . -x "*.DS_Store")
echo "Built public/msrp-finder-helper.zip"
