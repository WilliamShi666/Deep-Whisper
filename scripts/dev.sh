#!/bin/bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
exec pnpm dev
