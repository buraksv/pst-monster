export type BumpKind = 'auto' | 'major' | 'minor' | 'patch'
export function parseVersion(version: string): { major: number; minor: number; patch: number }
export function nextVersion(current: string, tags: Iterable<string>, kind?: BumpKind): string
