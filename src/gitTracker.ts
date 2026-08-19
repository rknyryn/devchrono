import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GitTracker extends vscode.Disposable {}

/** Parses the current branch name from .git/HEAD content. */
function parseBranchFromHead(headContent: string): string {
  if (headContent.startsWith('ref: refs/heads/')) {
    return headContent.replace('ref: refs/heads/', '');
  }
  return '(detached)';
}

/** Normalise a path for case-insensitive comparison on all platforms. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Returns the absolute git top-level directory for workspacePath, or undefined
 * if the path is not inside a git repository. Handles worktrees, submodules,
 * and workspaces that are subdirectories of a larger repo.
 */
function getGitTopLevel(workspacePath: string): string | undefined {
  try {
    const result = cp.spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      encoding: 'utf8',
      timeout: 3000,
    });
    const top = result.stdout?.trim();
    return (result.status === 0 && top) ? top : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Starts watching for new commits and branch changes in the given workspace.
 * Returns a disposable that stops all watchers when disposed.
 * Returns undefined silently if the workspace has no git repository.
 *
 * Strategy: try the built-in vscode.git API first (preferred — no shell calls).
 * If unavailable or the repo isn't found in it, fall back to a FileSystemWatcher
 * on .git/COMMIT_EDITMSG + .git/HEAD for commits and branch changes respectively.
 *
 * Important: onCommit is NOT fired when a branch switch also changes HEAD.commit —
 * that avoids recording a checkout as a user-authored commit.
 */
export function createGitTracker(
  workspacePath: string,
  onCommit: (hash: string) => void,
  onBranchChange?: (branch: string) => void
): GitTracker | undefined {
  // Primary: vscode.git extension API
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (gitExt?.isActive) {
    try {
      const api = gitExt.exports.getAPI(1);
      // Case-insensitive containment match — handles Windows casing differences
      // and workspaces that are subdirectories of the repo root.
      const wsNorm = normPath(workspacePath);
      const repo = api.repositories.find((r: { rootUri: vscode.Uri }) => {
        const rNorm = normPath(r.rootUri.fsPath);
        return wsNorm === rNorm || wsNorm.startsWith(rNorm + '/');
      });
      if (repo) {
        let lastCommit: string | undefined = repo.state.HEAD?.commit;
        let lastBranchName: string | undefined = repo.state.HEAD?.name;
        let branchDebounce: NodeJS.Timeout | undefined;
        // If initial HEAD state was unavailable, capture it on the first event
        // instead of treating it as a branch change.
        let stateSeenAtLeastOnce = lastBranchName !== undefined || lastCommit !== undefined;

        const sub = repo.state.onDidChange(() => {
          const newCommit: string | undefined = repo.state.HEAD?.commit;
          const newBranchName: string | undefined = repo.state.HEAD?.name;

          if (!stateSeenAtLeastOnce) {
            // Initial git state arrived — record without firing events.
            lastBranchName = newBranchName;
            lastCommit = newCommit;
            stateSeenAtLeastOnce = true;
            return;
          }

          const newBranch = newBranchName ?? '(detached)';
          const oldBranch = lastBranchName ?? '(detached)';
          const branchChanged = newBranch !== oldBranch;
          const commitChanged = newCommit && newCommit !== lastCommit;

          if (branchChanged && onBranchChange) {
            lastBranchName = newBranchName;
            lastCommit = newCommit; // sync so we don't fire a stale commit event after
            if (branchDebounce) { clearTimeout(branchDebounce); }
            // Read the settled branch from repo state after a short delay to skip
            // transient undefined/detached states during rebase operations.
            branchDebounce = setTimeout(() => {
              const settledName = repo.state.HEAD?.name;
              const settledBranch = settledName ?? '(detached)';
              // Update tracking state to the settled values so subsequent
              // events compare against the correct baseline.
              lastBranchName = settledName;
              lastCommit = repo.state.HEAD?.commit;
              onBranchChange(settledBranch);
            }, 300);
          } else if (commitChanged && !branchChanged) {
            // Only record a commit when the branch stayed the same — avoids
            // logging a checkout operation as a user-authored commit.
            lastCommit = newCommit;
            onCommit(newCommit!);
          }
        });

        return {
          dispose: () => {
            sub.dispose();
            if (branchDebounce) { clearTimeout(branchDebounce); }
          }
        };
      }
    } catch {
      // vscode.git API call failed — fall through to file watcher
    }
  }

  // Fallback: file watchers on .git/COMMIT_EDITMSG (commits) and .git/HEAD (branches).
  // Use git rev-parse to find the actual git root — handles worktrees, submodules,
  // and workspaces that are subdirectories of a git repo.
  const gitRoot = getGitTopLevel(workspacePath);
  if (!gitRoot) { return undefined; }

  const commitWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(gitRoot, '.git/COMMIT_EDITMSG')
  );

  let lastHash: string | undefined;

  const readAndNotifyCommit = () => {
    try {
      const result = cp.spawnSync('git', ['log', '--format=%H', '-1'], {
        cwd: gitRoot,
        encoding: 'utf8',
        timeout: 3000,
      });
      const hash = result.stdout?.trim();
      if (hash && hash !== lastHash) {
        lastHash = hash;
        onCommit(hash);
      }
    } catch {
      // git not available or command failed — ignore silently
    }
  };

  commitWatcher.onDidChange(readAndNotifyCommit);
  commitWatcher.onDidCreate(readAndNotifyCommit);

  // Branch change watcher — .git/HEAD changes only on checkout, not on commit
  let lastFallbackBranch: string | undefined;
  let headDebounce: NodeJS.Timeout | undefined;
  const headPath = path.join(gitRoot, '.git', 'HEAD');

  try {
    lastFallbackBranch = parseBranchFromHead(fs.readFileSync(headPath, 'utf8').trim());
  } catch { /* ignore */ }

  const headWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(gitRoot, '.git/HEAD')
  );

  const handleHeadChange = () => {
    if (!onBranchChange) { return; }
    if (headDebounce) { clearTimeout(headDebounce); }
    headDebounce = setTimeout(() => {
      try {
        const newBranch = parseBranchFromHead(fs.readFileSync(headPath, 'utf8').trim());
        if (newBranch !== lastFallbackBranch) {
          lastFallbackBranch = newBranch;
          onBranchChange(newBranch);
        }
      } catch { /* ignore */ }
    }, 300);
  };

  headWatcher.onDidChange(handleHeadChange);
  headWatcher.onDidCreate(handleHeadChange);

  return {
    dispose: () => {
      commitWatcher.dispose();
      headWatcher.dispose();
      if (headDebounce) { clearTimeout(headDebounce); }
    }
  };
}
