#!/usr/bin/env bash
# WP31 — de Convex-backend naar prod (`npm run deploy:prod`).
#
# Alleen vanaf een schone `main` die gelijk is aan `origin/main`: deze checkout
# wordt door meerdere sessies tegelijk bewerkt, en `npx convex deploy` zet wat
# er in de werkmap staat op prod, gecommit of niet. Draai dit daarom in een
# eigen clone die alleen hiervoor is (bv. ~/Code/clubalmanac-v2-release).
#
# `npx convex deploy` vraagt zelf nog om bevestiging en noemt de deployment;
# controleer dat het de prod-deployment is.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail() {
  echo "[deploy:prod] $*" >&2
  exit 1
}

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[ "$branch" = "main" ] || fail "niet op main (wel: ${branch:-losse HEAD}). Geweigerd."

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  git status --short >&2
  fail "werkmap niet schoon. Geweigerd."
fi

git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  fail "main is niet gelijk aan origin/main (git pull, of push eerst via een PR). Geweigerd."

# Tests en typecheck niet opnieuw: main komt alleen via een PR met groene CI
# (ruleset). Wel de afhankelijkheden precies volgens de lockfile, want die
# gaan mee in de bundel. Zonder install-scripts: het enige pakket met zo'n
# script is esbuild, en dat vindt zijn binary ook zonder (via
# @esbuild/<platform>). sharp, heic-decode en nodemailer zijn
# externalPackages (convex.json); die installeert Convex zelf.
echo "[deploy:prod] main = origin/main = $(git rev-parse --short HEAD); afhankelijkheden volgens de lockfile"
npm ci --ignore-scripts

echo "[deploy:prod] deploy van $(git rev-parse --short HEAD)"
npx convex deploy
