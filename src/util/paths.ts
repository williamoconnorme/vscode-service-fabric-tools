/** Whether two absolute paths name the same file: case-insensitive on Windows, where the file system is. */
export function samePath(a: string, b: string): boolean {
	return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
