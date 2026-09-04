/**
 * Explorer State
 *
 * Isolated here to prevent circular imports between explorer.js,
 * explorer-render modules, and explorer-actions.js.
 */

export const explorerState = {
  // Path segments: [] = Root, ["Folder"] = Folder view, ["Folder", "Deck"] = Deck detail
  currentPath: [],
  history: [[]],
  historyIndex: 0,
  viewMode: (typeof localStorage !== "undefined" ? localStorage.getItem("explorer-view-mode") : null) || "grid", // 'grid' | 'details'
  searchQuery: "",
  expandedFolders: new Set()
};
