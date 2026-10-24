/** File paths, without assuming Node's `path`. */

/** Whether a path is absolute, on POSIX or Windows. */
export const isAbsolute = (path: string): boolean =>
  path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
