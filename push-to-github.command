#!/bin/bash
set -e

BASE="/Users/Marcus/Library/CloudStorage/GoogleDrive-marcus.hsia@gmail.com/My Drive/Claude"
REPO="$BASE/Projects/Website/outputs"
SSH_KEY="$BASE/Projects/Website/.ssh_key"

cd "$REPO"
rm -f .git/index.lock .git/HEAD.lock

git add -A

if git diff --cached --quiet; then
  echo "Nothing new to commit — already up to date."
else
  git commit -m "Remove Bitcoin Retirement Lab card from homepage"
fi

chmod 600 "$SSH_KEY"
GIT_SSH_COMMAND="ssh -i \"$SSH_KEY\" -o StrictHostKeyChecking=no" git push origin main

echo ""
echo "✓ Done! Visit: https://marcushsia.github.io/marcus-playground/"
