import type { ConvertOptions, ProgressEvent, ZipOptions, ZipProgressEvent } from '../core/types.js'

/**
 * The messages exchanged between the main process and the workers.
 *
 * Kept in one place so both ends of each channel are checked against the same
 * definitions.
 */

/** Every worker announces itself once it is listening. */
export interface ReadyMessage {
  type: 'ready'
}

/** Every worker accepts this, and stops at its next checkpoint. */
export interface CancelCommand {
  type: 'cancel'
}

/* Conversion worker ------------------------------------------------------- */

export type ConvertCommand = { type: 'start'; options: ConvertOptions } | CancelCommand

export type ConvertWorkerMessage = ProgressEvent | ReadyMessage

/* Archive worker ---------------------------------------------------------- */

export type ZipCommand = { type: 'start'; options: ZipOptions } | CancelCommand

export type ZipWorkerMessage = ZipProgressEvent | ReadyMessage
