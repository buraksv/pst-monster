import { describe, expect, it } from 'vitest'
import { nextVersion } from '../scripts/next-version.mjs'

describe('nextVersion', () => {
  it('releases the package.json version as is when it has no tag', () => {
    expect(nextVersion('2.0.0', ['v1.4.0', 'v1.5.0'])).toBe('2.0.0')
  })

  it('bumps the minor version once the current one is tagged', () => {
    expect(nextVersion('1.5.0', ['v1.4.0', 'v1.5.0'])).toBe('1.6.0')
  })

  it('skips numbers that already have a tag', () => {
    expect(nextVersion('1.5.0', ['v1.5.0', 'v1.6.0', 'v1.7.0'])).toBe('1.8.0')
  })

  it('accepts tags without the v prefix and ignores other tags', () => {
    expect(nextVersion('0.1.0', ['0.1.0', 'nightly', 'v0.2.0-beta'])).toBe('0.2.0')
  })

  it('bumps explicitly when asked', () => {
    expect(nextVersion('1.5.2', ['v1.5.2'], 'major')).toBe('2.0.0')
    expect(nextVersion('1.5.2', ['v1.5.2'], 'minor')).toBe('1.6.0')
    expect(nextVersion('1.5.2', ['v1.5.2'], 'patch')).toBe('1.5.3')
  })

  it('rejects versions that are not plain semver', () => {
    expect(() => nextVersion('1.5', [])).toThrow()
  })
})
