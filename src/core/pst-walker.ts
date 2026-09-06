import type { PSTFolder } from 'pst-extractor'

/**
 * Walks the folder tree of a PST file.
 *
 * A PST has two levels above the folders a user recognises: an unnamed file
 * root, and a container usually called "Top of Personal Folders". Neither is
 * something anyone wants in an export path, so both are collapsed by default
 * and the output starts directly at Inbox, Sent Items and the rest.
 */

/** The synthetic parent of every top-level folder, standing for the output directory. */
export const ROOT_ID = 0

export interface WalkedFolder {
  /** Unique within one walk. */
  id: number
  /** Id of the folder this one sits inside, or ROOT_ID for the top level. */
  parentId: number
  /**
   * Folder name as the PST stores it, or null when this level is collapsed and
   * its contents belong directly in the parent directory.
   */
  name: string | null
  folder: PSTFolder
  /** Messages directly in this folder, excluding subfolders. */
  messageCount: number
}

export interface WalkOptions {
  /** Keep the "Top of Personal Folders" level as the outermost export folder. */
  includeRootFolderName: boolean
}

function subFoldersOf(folder: PSTFolder): PSTFolder[] {
  try {
    return folder.hasSubfolders ? folder.getSubFolders() : []
  } catch {
    // A damaged folder table should cost us that branch, not the whole run.
    return []
  }
}

function contentCountOf(folder: PSTFolder): number {
  try {
    return folder.contentCount
  } catch {
    return 0
  }
}

function displayNameOf(folder: PSTFolder): string {
  try {
    return folder.displayName ?? ''
  } catch {
    return ''
  }
}

/** Total messages in a folder and everything beneath it. */
function subtreeMessageCount(folder: PSTFolder): number {
  let total = 0
  const stack: PSTFolder[] = [folder]
  while (stack.length > 0) {
    const current = stack.pop()!
    total += contentCountOf(current)
    stack.push(...subFoldersOf(current))
  }
  return total
}

/**
 * Yields every folder in the file, depth first, parents before children.
 *
 * @param root The result of `PSTFile.getRootFolder()`.
 */
export function* walkFolders(root: PSTFolder, options: WalkOptions): Generator<WalkedFolder> {
  const topLevel = subFoldersOf(root)

  // Collapse the top-level container holding the most mail: that is the tree
  // the user thinks of as their mailbox. Siblings such as the search-folder
  // root or a public-folder root keep their own names, so their contents cannot
  // silently merge into the export root.
  //
  // Counting is cheap here because folder counters are read without loading any
  // message.
  let collapseIndex = -1
  if (!options.includeRootFolderName && topLevel.length > 0) {
    let best = -1
    for (let i = 0; i < topLevel.length; i++) {
      const count = subtreeMessageCount(topLevel[i]!)
      if (count > best) {
        best = count
        collapseIndex = i
      }
    }
  }

  let nextId = ROOT_ID + 1
  const stack: WalkedFolder[] = []

  for (let i = topLevel.length - 1; i >= 0; i--) {
    const folder = topLevel[i]!
    stack.push({
      id: nextId++,
      parentId: ROOT_ID,
      name: i === collapseIndex ? null : displayNameOf(folder),
      folder,
      messageCount: 0,
    })
  }

  while (stack.length > 0) {
    const current = stack.pop()!
    current.messageCount = contentCountOf(current.folder)
    yield current

    const children = subFoldersOf(current.folder)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!
      stack.push({
        id: nextId++,
        parentId: current.id,
        name: displayNameOf(child),
        folder: child,
        messageCount: 0,
      })
    }
  }
}

/**
 * Counts every message in the file without loading any of them, so the progress
 * bar has a total before the slow pass starts.
 */
export function countMessages(root: PSTFolder, options: WalkOptions): number {
  let total = 0
  for (const entry of walkFolders(root, options)) total += entry.messageCount
  return total
}
