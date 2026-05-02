#!/bin/bash
set -e

BASE="/Users/Marcus/Library/CloudStorage/GoogleDrive-marcus.hsia@gmail.com/My Drive/Claude"
REPO="$BASE/Projects/Website/outputs"
SSH_KEY="$BASE/Projects/Website/.ssh_key"

cd "$REPO"

# Clear any stale lock
rm -f .git/index.lock .git/HEAD.lock

# Stage all changes
git add -A

# Commit if there are staged changes
if git diff --cached --quiet; then
  echo "Nothing new to commit — already up to date."
else
  git commit -m "Publish Pastor Pei project summary + update homepage card"
fi

# Push using the SSH key
chmod 600 "$SSH_KEY"
GIT_SSH_COMMAND="ssh -i \"$SSH_KEY\" -o StrictHostKeyChecking=no" git push origin main

echo ""
echo "✓ Done! Visit: https://marcushsia.github.io/marcus-playground/pastor-pei/"
