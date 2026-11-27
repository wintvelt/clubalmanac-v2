#!/usr/bin/env bash
# De Convex-backend naar dev, vanaf de convex-dev-stapel (`npm run deploy:convex-dev`).
# Afspraak: docs/conventions/convex-dev-stapel.md.
#
# Een deploy zet de hele map convex/ neer; wat er stond, verdwijnt. Daarom
# deployt niemand dev vanaf zijn eigen WP-branch, maar alleen vanaf deze
# stapel: origin/main plus de open WP-branches uit `.convex-dev-stapel` (één
# branch per regel, `#` is commentaar), in die volgorde samengevoegd.
#
# Alleen in de eigen worktree op branch `convex-dev-stapel`
# (~/Code/clubalmanac-v2-convex-dev). Elke run bouwt de stapel opnieuw op
# vanaf origin/main. Een conflict dat eerder is opgelost, lost git rerere
# zelf weer op; een nieuw conflict stopt de run vóór de deploy.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail() {
  echo "[deploy:convex-dev] $*" >&2
  exit 1
}

# De run zet de werkmap terug op origin/main, en daarin kan dit script
# ontbreken of anders zijn. Draai daarom vanaf een kopie in .git.
if [ -z "${CONVEX_DEV_STAPEL_COPY:-}" ]; then
  copy="$(git rev-parse --git-dir)/deploy-convex-dev.sh"
  cp "$0" "$copy"
  exec env CONVEX_DEV_STAPEL_COPY=1 bash "$copy" "$@"
fi

LIST=".convex-dev-stapel"
# `--zonder-deploy`: alles behalve de deploy (stapel opbouwen en testen).
DEPLOY=1
[ "${1:-}" = "--zonder-deploy" ] && DEPLOY=0

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[ "$branch" = "convex-dev-stapel" ] || fail "niet op convex-dev-stapel (wel: ${branch:-losse HEAD}). Geweigerd."

grep -q '^CONVEX_DEPLOYMENT=dev:' .env.local 2>/dev/null ||
  fail ".env.local wijst niet naar een dev-deployment. Geweigerd."

[ -f "$LIST" ] || fail "geen $LIST (één WP-branch per regel). Geweigerd."

if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  fail "er loopt nog een merge. Los hem op en commit, of 'git merge --abort', en draai opnieuw."
fi

if [ -n "$(git status --porcelain --untracked-files=all -- . ":(exclude)$LIST")" ]; then
  git status --short >&2
  fail "werkmap niet schoon. Geweigerd."
fi

git fetch --quiet origin main
git reset --quiet --hard origin/main
echo "[deploy:convex-dev] basis: origin/main = $(git rev-parse --short HEAD)"

branches=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line="$(echo "$line" | tr -d '[:space:]')"
  [ -n "$line" ] && branches+=("$line")
done < "$LIST"

for b in "${branches[@]}"; do
  git rev-parse -q --verify "refs/heads/$b" >/dev/null || fail "branch $b bestaat niet. Geweigerd."
  if git -c rerere.enabled=true -c rerere.autoupdate=true merge --no-ff --no-edit --quiet "refs/heads/$b" >/dev/null 2>&1; then
    echo "[deploy:convex-dev] + $b ($(git rev-parse --short "refs/heads/$b"))"
  elif [ -z "$(git diff --name-only --diff-filter=U)" ]; then
    git -c rerere.enabled=true commit --quiet --no-edit
    echo "[deploy:convex-dev] + $b ($(git rev-parse --short "refs/heads/$b"), conflict opgelost via rerere)"
  else
    git diff --name-only --diff-filter=U >&2
    fail "nieuw conflict bij $b. Los het hier op en commit (rerere onthoudt het), draai dan opnieuw. Niets gedeployd."
  fi
done

echo "[deploy:convex-dev] afhankelijkheden, typecheck en tests van de stapel"
npm ci --ignore-scripts --silent
(cd app && npm ci --ignore-scripts --silent)
npx tsc --noEmit
npx vitest run --reporter=dot

if [ "$DEPLOY" = 0 ]; then
  echo "[deploy:convex-dev] stapel groen ($(git rev-parse --short HEAD)); niet gedeployd (--zonder-deploy)"
  exit 0
fi

echo "[deploy:convex-dev] deploy naar dev van $(git rev-parse --short HEAD): ${branches[*]:-alleen main}"
npx convex dev --once
