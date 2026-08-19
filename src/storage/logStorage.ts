import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const SCHEMA_VERSION = 3;
const LOG_FILENAME = 'time-log.json';

export interface Session {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
  lastHeartbeat: string;
  recovered: boolean;
  commits?: string[];   // v2+: commit hashes recorded during this session
  branch?: string;      // v2.1+: git branch name at session start ('' = non-git or unknown)
  idleSeconds?: number;    // v3+: total idle time excluded from this session
  activeSeconds?: number;  // v3+: duration - idleSeconds (convenience for display/queries)
  source?: 'pomodoro';     // v5.2+: 'pomodoro' if session was started by Pomodoro manager
}

export interface ProjectLog {
  schemaVersion: number;
  projectName: string;
  projectPath: string;
  createdAt: string;
  sessions: Session[];
}

/** Returns the absolute path to .vscode/time-log.json, or undefined if no workspace is open. */
export function getLogPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return path.join(folders[0].uri.fsPath, '.vscode', LOG_FILENAME);
}

/**
 * Reads and parses the log file. Returns undefined if missing or corrupt (corrupt files are deleted).
 * @param workspacePath Optional override — useful when calling outside of the active workspace context.
 */
export function readLog(workspacePath?: string): ProjectLog | undefined {
  const logPath = workspacePath
    ? path.join(workspacePath, '.vscode', LOG_FILENAME)
    : getLogPath();
  if (!logPath) {
    return undefined;
  }

  if (!fs.existsSync(logPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    const parsed = JSON.parse(raw) as ProjectLog;

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.sessions)) {
      throw new Error('Invalid log structure');
    }

    // Migrate schema if needed (currently only version 1 exists)
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return migrateLog(parsed);
    }

    return parsed;
  } catch {
    // Silent recovery: delete corrupt file
    try {
      fs.unlinkSync(logPath);
    } catch {
      // Ignore deletion errors
    }
    return undefined;
  }
}

/** Writes log atomically: write to .tmp then rename over the target. */
export function writeLog(log: ProjectLog): void {
  const logPath = getLogPath();
  if (!logPath) {
    return;
  }

  const vscodeDir = path.dirname(logPath);
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  const tmpPath = logPath + '.tmp';
  const content = JSON.stringify(log, null, 2);

  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    // On Windows, renameSync overwrites the destination if it exists
    fs.renameSync(tmpPath, logPath);
  } catch {
    // Fallback: direct write if atomic rename fails (e.g., cross-device)
    try {
      fs.writeFileSync(logPath, content, 'utf8');
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    } catch {
      // Silently fail — extension must not crash on write errors
    }
  }
}

/**
 * Finds sessions with an empty endTime (orphans from crashes) and recovers them.
 * endTime is set to lastHeartbeat, or startTime if no heartbeat was recorded.
 */
export function recoverOrphanSessions(): void {
  const log = readLog();
  if (!log) {
    return;
  }

  let dirty = false;

  for (const session of log.sessions) {
    if (!session.endTime) {
      const endTime = session.lastHeartbeat || session.startTime;
      session.endTime = endTime;
      session.recovered = true;

      const start = new Date(session.startTime).getTime();
      const end = new Date(endTime).getTime();
      session.duration = Math.max(0, Math.floor((end - start) / 1000));

      dirty = true;
    }
  }

  if (dirty) {
    writeLog(log);
  }
}

/** Creates a fresh ProjectLog for the given workspace. */
export function createNewLog(workspaceName: string, workspacePath: string): ProjectLog {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectName: workspaceName,
    projectPath: workspacePath,
    createdAt: new Date().toISOString(),
    sessions: [],
  };
}

/** Applies incremental schema migrations until the log is at SCHEMA_VERSION. */
function migrateLog(log: ProjectLog): ProjectLog {
  if ((log.schemaVersion ?? 0) < 2) {
    // v1 → v2: add commits array to each session
    for (const session of log.sessions) {
      if (!session.commits) {
        session.commits = [];
      }
    }
    log.schemaVersion = 2;
  }

  if ((log.schemaVersion ?? 0) < 3) {
    // v2 → v3: add idleSeconds and activeSeconds (default to 0 / duration)
    for (const session of log.sessions) {
      if (session.idleSeconds === undefined) { session.idleSeconds = 0; }
      if (session.activeSeconds === undefined) { session.activeSeconds = session.duration; }
    }
    log.schemaVersion = 3;
  }

  return log;
}
