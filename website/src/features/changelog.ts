// The published packages whose changelogs the site shows, in the order the sidebar lists them
export const changelogPackages = [
  { id: "browser", name: "@usestrider/browser", route: "/changelog" },
  { id: "cli", name: "@usestrider/cli", route: "/changelog/cli" },
  { id: "vitest", name: "@usestrider/vitest", route: "/changelog/vitest" }
] as const
