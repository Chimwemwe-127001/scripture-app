#!/usr/bin/env bash
echo "============================================"
echo " Scripture Suggestion Panel: Python Setup"
echo "============================================"
echo
pip3 install -r "$(dirname "$0")/requirements.txt"
echo
echo "The first time you press Listen, the speech model (about 1.5 GB) is downloaded."
echo "An NVIDIA GPU is used automatically when there is one."
echo
echo "Done. Launch with: npm run dev"
