#!/bin/bash
set -e

BASE="/Users/Marcus/Library/CloudStorage/GoogleDrive-marcus.hsia@gmail.com/My Drive/Claude"
REPO="$BASE/Projects/Website/outputs"
SSH_KEY="$BASE/Projects/Website/.ssh_key"
STAGED_FILE="$BASE/index_homepage_update.html"

# Copy the updated homepage into position
if [ -f "$STAGED_FILE" ]; then
  cp "$STAGED_FILE" "$REPO/index.html"
  echo "✓ Updated index.html"
else
  echo "⚠️  Staged file not found at: $STAGED_FILE"
  exit 1
fi

cd "$REPO"
rm -f .git/index.lock
git add -A

if git diff --cached --quiet; then
  echo "Nothing new to commit — already up to date."
else
  git commit -m "Add archived projects section; rename active projects section"
fi

chmod 600 "$SSH_KEY"
GIT_SSH_COMMAND="ssh -i \"$SSH_KEY\" -o StrictHostKeyChecking=no" git push origin main

echo ""
echo "✓ Done! Visit: https://marcushsia.github.io/marcus-playground/"
