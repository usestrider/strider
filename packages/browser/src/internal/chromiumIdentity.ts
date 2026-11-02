/** A browser claim needs the browser WebSocket GUID, not an arbitrary proxy or page endpoint path. */
export const fromWebSocket = (endpoint: string): string | undefined =>
  /^\/devtools\/browser\/([^/]+)$/.exec(new URL(endpoint).pathname)?.[1]
