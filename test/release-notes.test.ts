import { describe, expect, it } from 'vitest'
import { buildNotes, missingPlatforms } from '../scripts/release-notes.mjs'

/** Exactly what the three build pipelines upload for one version. */
const FULL = [
  'SHA256SUMS.txt',
  'pst-monster-1.2.0-linux-amd64.deb',
  'pst-monster-1.2.0-linux-x64.tar.gz',
  'pst-monster-1.2.0-linux-x86_64.AppImage',
  'pst-monster-1.2.0-macos-arm64.dmg',
  'pst-monster-1.2.0-macos-arm64.zip',
  'pst-monster-1.2.0-macos-x64.dmg',
  'pst-monster-1.2.0-macos-x64.zip',
  'pst-monster-1.2.0-windows-portable.exe',
  'pst-monster-1.2.0-windows-setup.exe',
]

describe('buildNotes', () => {
  it('names an operating system for every package', () => {
    const notes = buildNotes(FULL, '1.2.0')
    for (const file of FULL.filter((f) => f !== 'SHA256SUMS.txt')) {
      expect(notes).toContain(file)
    }
    expect(notes).toContain('**Windows 10/11**')
    expect(notes).toContain('**macOS · Apple Silicon**')
    expect(notes).toContain('**macOS · Intel**')
    expect(notes).toContain('**Ubuntu · Debian**')
  })

  it('tells the two Mac builds apart', () => {
    const notes = buildNotes(FULL, '1.2.0')
    const arm = notes.split('\n').find((l) => l.includes('macos-arm64.dmg'))
    const intel = notes.split('\n').find((l) => l.includes('macos-x64.dmg'))
    expect(arm).toContain('Apple Silicon')
    expect(intel).toContain('Intel')
  })

  it('lists Windows before macOS before Linux', () => {
    const notes = buildNotes(FULL, '1.2.0')
    expect(notes.indexOf('windows-setup.exe')).toBeLessThan(notes.indexOf('macos-arm64.dmg'))
    expect(notes.indexOf('macos-x64.dmg')).toBeLessThan(notes.indexOf('linux-amd64.deb'))
  })

  it('gives each file its own row', () => {
    const notes = buildNotes(FULL, '1.2.0')
    const rows = notes.split('\n').filter((l) => l.startsWith('| **'))
    expect(rows).toHaveLength(FULL.length - 1)
  })

  it('mentions the checksum file only when it is there', () => {
    expect(buildNotes(FULL, '1.2.0')).toContain('SHA256SUMS.txt')
    expect(buildNotes(['pst-monster-1.2.0-windows-setup.exe'], '1.2.0')).not.toContain(
      'SHA256SUMS.txt',
    )
  })

  it('still mentions a package it has no rule for', () => {
    const notes = buildNotes([...FULL, 'pst-monster-1.2.0-linux-arm64.deb'], '1.2.0')
    expect(notes).toContain('Diğer dosyalar')
    expect(notes).toContain('pst-monster-1.2.0-linux-arm64.deb')
  })

  it('gives a row only to packages that are actually in the release', () => {
    const notes = buildNotes(['pst-monster-1.2.0-windows-setup.exe'], '1.2.0')
    const rows = notes.split('\n').filter((l) => l.startsWith('| **'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('windows-setup.exe')
  })

  it('says which operating systems have not been built yet', () => {
    const notes = buildNotes(['pst-monster-1.2.0-windows-setup.exe'], '1.2.0')
    expect(notes).toContain('macOS, Linux')
  })

  it('says nothing about missing systems once the release is complete', () => {
    expect(buildNotes(FULL, '1.2.0')).not.toContain('henüz üretilmedi')
  })
})

describe('missingPlatforms', () => {
  it('finds nothing missing in a complete release', () => {
    expect(missingPlatforms(FULL)).toEqual([])
  })

  it('names each system that has no package', () => {
    expect(missingPlatforms(['pst-monster-1.2.0-linux-amd64.deb'])).toEqual(['windows', 'macos'])
  })

  it('counts a system as present from any one of its packages', () => {
    // The AppImage alone is enough to say Linux is covered.
    expect(missingPlatforms(['pst-monster-1.2.0-linux-x86_64.AppImage'])).not.toContain('linux')
  })

  it('ignores files it has no rule for', () => {
    expect(missingPlatforms(['SHA256SUMS.txt', 'notes.md'])).toEqual(['windows', 'macos', 'linux'])
  })
})
