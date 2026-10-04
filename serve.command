#!/bin/bash
cd "$(dirname "$0")"
(sleep 1; open "http://127.0.0.1:8790/") &
python3 tools/serve.py 8790
