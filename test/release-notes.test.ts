import { describe, expect, it } from 'vitest'
import { buildNotes } from '../scripts/release-notes.mjs'

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

  it('leaves out rows for packages that are not in the release', () => {
    const notes = buildNotes(['pst-monster-1.2.0-windows-setup.exe'], '1.2.0')
    expect(notes).not.toContain('macOS')
    expect(notes).not.toContain('AppImage')
  })
})
