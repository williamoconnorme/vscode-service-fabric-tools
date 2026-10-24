import type * as vscode from 'vscode';

/**
 * Argument shape for commands invoked from an Explorer or tree context menu.
 * `extension.ts` wraps a bare `vscode.Uri` argument as `{ resource }`.
 */
export interface CommandTarget {
	resource?: vscode.Uri;
}
