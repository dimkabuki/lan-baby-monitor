#!/usr/bin/env bash
set -euo pipefail
repo="${1:-dimkabuki/lan-baby-monitor}"
gh repo edit "$repo" --default-branch main --enable-squash-merge --disable-merge-commit --disable-rebase-merge --delete-branch-on-merge
# Run after bootstrap CI establishes these check names, before ordinary feature PRs.
gh api --method PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["quality","browser","installer"]},"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0,"dismiss_stale_reviews":true,"require_code_owner_reviews":false},"restrictions":null,"required_linear_history":true,"allow_force_pushes":false,"allow_deletions":false,"required_conversation_resolution":true}
JSON
gh api "repos/$repo/branches/main/protection"
