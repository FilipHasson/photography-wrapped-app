// Light or dark, the same way in every photography project: follow the OS until
// someone presses the button, then keep their choice. Loaded in <head>, ahead of
// the stylesheet and without defer, so a stored choice is on <html> before the
// first paint. The button is added here because it does nothing without this.
(() => {
  const KEY = "theme";
  const root = document.documentElement;
  const os = window.matchMedia("(prefers-color-scheme: dark)");

  const stored = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };

  const apply = (mode) => {
    if (mode) root.dataset.theme = mode;
    else delete root.dataset.theme;
    window.dispatchEvent(new Event("themechange"));
  };

  const toggle = () => {
    const current = root.dataset.theme ?? (os.matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private windows can refuse. The choice still holds for this page.
    }
    apply(next);
  };

  apply(stored());
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) apply(stored());
  });

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".topbar-right");
    if (!bar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.title = "Switch between light and dark";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = `
      <svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      <svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
    button.addEventListener("click", toggle);
    bar.insertBefore(button, bar.querySelector(".primary"));
  });
})();
