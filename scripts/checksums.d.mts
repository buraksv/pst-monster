export const SUMS_FILE: string
export function parseSums(text: string): Map<string, string>
export function mergeSums(existing: Map<string, string>, fresh: Map<string, string>): string
export function hashFile(path: string): Promise<string>
