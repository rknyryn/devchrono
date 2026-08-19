import * as vscode from 'vscode';
import * as fs from 'fs';
import { readLog, getLogPath } from './storage/logStorage';

/**
 * Exports all completed sessions from the current workspace's time-log.json to a CSV file.
 * Opens a save dialog so the user can choose the output path.
 */
export async function exportLogAsCsv(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('DevChrono: No workspace open — nothing to export.');
    return;
  }

  const log = readLog(folders[0].uri.fsPath);
  if (!log) {
    vscode.window.showWarningMessage('DevChrono: No time log found for this workspace.');
    return;
  }

  const completed = log.sessions.filter(s => s.endTime);
  if (completed.length === 0) {
    vscode.window.showInformationMessage('DevChrono: No completed sessions to export yet.');
    return;
  }

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${log.projectName}-time-log.csv`),
    filters: { 'CSV Files': ['csv'], 'All Files': ['*'] },
    title: 'Export DevChrono Log',
  });

  if (!saveUri) {
    return; // user cancelled
  }

  const csv = buildCsv(log.projectName, completed);
  const BOM = '\uFEFF';

  try {
    fs.writeFileSync(saveUri.fsPath, BOM + csv, 'utf8');
    vscode.window.showInformationMessage(
      `DevChrono: Exported ${completed.length} session${completed.length === 1 ? '' : 's'} to ${saveUri.fsPath}`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`DevChrono: Export failed — ${String(err)}`);
  }
}

const SEP = ';';

/** Formats a value for CSV: wraps in quotes and escapes internal quotes. */
function csvCell(value: string | number | undefined): string {
  const str = String(value ?? '');
  if (str.includes(SEP) || str.includes('"') || str.includes('\n') || str.includes(',')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toDateStr(isoStr: string): string {
  try {
    return isoStr.slice(0, 10); // "YYYY-MM-DD"
  } catch {
    return '';
  }
}

function buildCsv(
  projectName: string,
  sessions: import('./storage/logStorage').Session[]
): string {
  const header = [
    'date', 'project', 'branch', 'start', 'end',
    'duration_min', 'active_min', 'source',
  ].join(SEP);

  const rows = sessions.map(s => {
    const durationMin = Math.round((s.duration || 0) / 60);
    const activeMin = s.activeSeconds !== undefined
      ? Math.round(s.activeSeconds / 60)
      : durationMin;

    return [
      csvCell(toDateStr(s.startTime)),
      csvCell(projectName),
      csvCell(s.branch ?? ''),
      csvCell(s.startTime),
      csvCell(s.endTime),
      csvCell(durationMin),
      csvCell(activeMin),
      csvCell(s.source ?? ''),
    ].join(SEP);
  });

  return [header, ...rows].join('\r\n') + '\r\n';
}
