// Lospec500, collaborative palette: https://lospec.com/palette-list/lospec500
// Bundled locally; displaying benchmark results never requests palette assets.
export const LOSPEC500 = [
  "#10121c", "#2c1e31", "#6b2643", "#ac2847", "#ec273f", "#94493a", "#de5d3a",
  "#e98537", "#f3a833", "#4d3533", "#6e4c30", "#a26d3f", "#ce9248", "#dab163",
  "#e8d282", "#f7f3b7", "#1e4044", "#006554", "#26854c", "#5ab552", "#9de64e",
  "#008b8b", "#62a477", "#a6cb96", "#d3eed3", "#3e3b65", "#3859b3", "#3388de",
  "#36c5f4", "#6dead6", "#5e5b8c", "#8c78a5", "#b0a7b8", "#deceed", "#9a4d76",
  "#c878af", "#cc99ff", "#fa6e79", "#ffa2ac", "#ffd1d5", "#f6e8e0", "#ffffff",
] as const;

export const ETC_COLOR = LOSPEC500[32];
// Start with separated hues; reserve the muted neutral for etc. No generated colors.
export const FUNCTION_COLORS = [27, 8, 19, 36, 6, 29, 37, 14, 21, 35, 12, 23, 26, 4, 28,
  20, 31, 7, 22, 38, 11, 24, 30, 34, 13, 18, 33, 5, 15, 17, 39, 25, 3, 40, 16, 10, 2, 9, 41, 1, 0]
  .map((index) => LOSPEC500[index]);
