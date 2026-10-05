(() => {
  let theme;
  try { theme = localStorage.getItem("singgah-theme"); } catch { /* Penyimpanan mungkin diblokir. */ }
  if (!["light", "dark"].includes(theme)) {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = theme;
})();