/* ================= SkyLauncher — simple view router ================= */
window.SK = window.SK || {};

SK.router = (function () {
  const views = document.querySelectorAll(".view");
  const navItems = document.querySelectorAll(".nav-item[data-view]");
  const pageTitle = document.getElementById("page-title");
  const pageDesc = document.getElementById("page-desc");

  const labels = {
    home: "Главная",
    versions: "Версии",
    mods: "Моды",
    files: "Файлы",
    journal: "Журнал",
    settings: "Настройки",
    accounts: "Автономный вход",
  };
  const descs = {
    home: "Запускай примеры, trackь время и управляй аккаунтами",
    versions: "Установка и управление версиями Minecraft",
    mods: "Поиск и установка модов из Modrinth и CurseForge",
    files: "Файловый менеджер папки .minecraft",
    journal: "Логи и журнал работы Minecraft",
    settings: "Настройка лаунчера, Java и внешнего вида",
    accounts: "Автономные учётные записи для офлайн-игры",
  };

  function hideAll() {
    views.forEach(v => (v.style.display = "none"));
    navItems.forEach(n => n.classList.remove("active"));
  }

  function show(viewId, opts = {}) {
    hideAll();
    const view = document.getElementById("view-" + viewId);
    const nav = document.querySelector('.nav-item[data-view="' + viewId + '"]');
    if (view) view.style.display = "block";
    if (nav) nav.classList.add("active");
    if (pageTitle) pageTitle.textContent = labels[viewId] || viewId;
    if (pageDesc) pageDesc.textContent = opts.desc || descs[viewId] || "";

    // route-specific init
    if (SK.app && SK.app.onViewShow) SK.app.onViewShow(viewId);

    // remember current view
    try { localStorage.setItem("skylauncher_view", viewId); } catch (e) {}
  }

  function current() {
    for (const v of views) if (v.style.display === "block") return v.id.replace("view-", "");
    return "home";
  }

  navItems.forEach(n => {
    n.addEventListener("click", (e) => {
      e.preventDefault();
      show(n.dataset.view);
    });
  });

  // initial
  const saved = localStorage.getItem("skylauncher_view") || "home";
  return { show, current, hideAll };
})();
