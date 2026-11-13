/** File paths, without assuming Node's `path`. */

/** Whether a path is absolute, on POSIX or Windows. */
export const isAbsolute = (path: string): boolean =>
  path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")

/** The directory holding a path, on POSIX or Windows; a root is its own. */
export const dirname = (path: string): string => {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (at < 0) return "."
  const head = path.slice(0, at)
  return head === "" || /^[A-Za-z]:$/.test(head) ? path.slice(0, at + 1) : head
}
