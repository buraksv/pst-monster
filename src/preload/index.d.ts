import type { Api } from '../shared/channels.js'

/** What the preload script publishes onto the window object. */
declare global {
  interface Window {
    api: Api
  }
}

export {}
