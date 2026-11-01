/* ================= SkyLauncher — application ================= */
window.SK = window.SK || {};

(function () {
  const SK = window.SK;

  // ---------- UI helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const html = (el, str) => { el.innerHTML = str; return el; };

  function toast(msg, kind = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show";
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme || "dark");
    $("#btn-theme").textContent = (theme === "dark" ? "☀️" : "🌙") + " Тема";
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    applyTheme(next);
    SK.storage.saveSettings(Object.assign(SK.storage.settings(), { theme: next }));
    toast(next === "dark" ? "Тёмная тема" : "Светлая тема");
  }

  // ---------- Modal ----------
  let currentModal = null;
  function openModal(title, bodyHtml, footHtml) {
    const tpl = $("#tpl-token");
    const clone = tpl.content.cloneNode(true);
    const modal = clone.querySelector(".modal");
    modal.querySelector("#modal-title").textContent = title;
    modal.querySelector("#modal-body").innerHTML = bodyHtml;
    modal.querySelector("#modal-foot").innerHTML = footHtml || "";
    modal.querySelector("#modal-close").onclick = closeModal;
    modal.querySelector(".overlay-close")?.onclick ?? null;
    const overlay = $("#overlay");
    overlay.style.display = "flex";
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    currentModal = modal;
    // close on overlay click
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    return modal;
  }
  function closeModal() {
    if (currentModal) currentModal.style.display = "none";
    $("#overlay").style.display = "none";
    document.body.style.overflow = "";
    currentModal = null;
  }

  // ---------- Format helpers ----------
  function fmtDate(dstr) { return dstr; } // already formatted in mock data
  function fmtSize(bytes) {
    if (!bytes) return "—";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let b = bytes, i = 0;
    while (b >= 1024 && i < 3) { b /= 1024; i++; }
    return b.toFixed(1) + " " + units[i];
  }

  // ---------- Active account UI ----------
  function refreshAccountUI() {
    const acc = SK.storage.activeAccount();
    if (!acc) return;
    const avatar = $("#user-avatar");
    const nameEl = $("#user-name");
    const statusEl = $("#user-status");
    nameEl.textContent = acc.name;
    statusEl.textContent = acc.type + (acc.email ? " • " + acc.email : "");
    avatar.textContent = acc.avatar || "?";
    // skin badge not shown here
  }

  // ---------- View: HOME / instances ----------
  function renderHome() {
    const grid = $("#inst-grid");
    const empty = $("#inst-empty");
    const instances = SK.storage.instances();
    grid.innerHTML = "";
    instances.forEach(inst => {
      const card = document.createElement("article");
      card.className = "inst-card";
      const playtimeBadge = inst.status ? `<span class="inst-badge">${escapeHtml(inst.status)}</span>` : "";
      card.innerHTML = `
        <div class="inst-header">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:34px;height:34px;border-radius:10px;background:var(--panel-hover);border:1px solid var(--border);display:grid;place-items:center;font-size:18px;flex-shrink:0">${inst.icon}</div>
            <div>
              <div class="inst-name">${escapeHtml(inst.name)}</div>
              <div class="inst-ver">${escapeHtml(inst.version)} · ${escapeHtml(inst.modLoader)}</div>
            </div>
          </div>
          ${playtimeBadge}
        </div>
        <div class="inst-meta">
          <span>Последний запуск: ${escapeHtml(inst.lastPlayed)}</span>
          <span>Играно: ${escapeHtml(inst.playtime)}</span>
          <span class="muted">Всего: ${escapeHtml(inst.total)}</span>
        </div>
        <div class="inst-actions">
          <button class="btn primary" onclick="SK.app.playInst('${escapeAttr(inst.id)}')" title="Играть">Играть</button>
          <button class="btn outline btn-sm" onclick="SK.app.instOpts('${escapeAttr(inst.id)}')" title="Настройки">⚙</button>
        </div>
      `;
      grid.appendChild(card);
    });
    empty.style.display = instances.length ? "none" : "block";
  }
  SK.app = SK.app || {};
  SK.app.playInst = function (id) {
    const inst = SK.storage.instances().find(i => i.id === id);
    const acc = SK.storage.activeAccount();
    if (!inst) return;
    const now = new Date();
    const ds = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    // simulate launch
    const btn = document.querySelector(`button[onclick*="${id}"]`);
    if (btn) { const old = btn.textContent; btn.textContent = "Запуск…"; btn.disabled = true; }
    addJournal(`[main/INFO] Запуск ${escapeHtml(inst.name)} (${escapeHtml(inst.version)})`, "info");
    addJournal(`[auth/INFO] Автономный вход: ${escapeHtml(acc ? acc.name : "игрок")}`, "info");
    setTimeout(() => {
      if (btn) { btn.textContent = "Играть"; btn.disabled = false; }
      toast("Запущено: " + inst.name);
      addJournal(`[client/INFO] Окно игры открыто. Аккаунт: ${escapeHtml(acc ? acc.name : "—")}`, "info");
      // update last played
      const insts = SK.storage.instances().map(i => {
        if (i.id === id) i.lastPlayed = ds;
        return i;
      });
      SK.storage.saveInstances(insts);
      renderHome();
    }, 900);
  };
  SK.app.instOpts = function (id) {
    toast("Настройки примера скоро в этом выпуске");
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return String(s).replace(/'/g, "&#39;"); }

  // ---------- View: VERSIONS ----------
  function renderVersions() {
    const filterSel = $$('input[name="vf"]');
    const tbody = $("#ver-tbody");
    const search = $("#ver-search").value.toLowerCase();
    const getFilter = () => filterSel.find(i => i.checked).value;
    tbody.innerHTML = "";
    let shown = 0;
    SK.MC_VERSIONS.forEach(v => {
      if (search && !v.id.toLowerCase().includes(search)) return;
      if (getFilter() !== "all" && v.type !== getFilter()) return;
      shown++;
      const installed = v.installed;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="width:24px"><span class="muted">${installed ? "✓" : "○"}</span></td>
        <td><b style="color:var(--text)">${escapeHtml(v.id)}</b></td>
        <td><span class="ver-type ${v.type}">${v.type === "release" ? "Релиз" : v.type === "snapshot" ? "Снэпшот" : "Старая"}</span></td>
        <td class="num">${escapeHtml(v.released)}</td>
        <td class="num"><span style="color:${installed ? "var(--success)" : "var(--muted-2)"}" class="muted">${installed ? "Установлен" : "Не установлен"}</span></td>
        <td class="num">
          ${installed ? `<button class="btn btn-sm ghost" onclick="SK.app.launchVer('${escapeAttr(v.id)}')" title="Играть на версии">Играть</button>` : `<button class="btn btn-sm primary" onclick="SK.app.installVer('${escapeAttr(v.id)}')" title="Установить">Установить</button>`}
        </td>
      `;
      tbody.appendChild(tr);
    });
    if (shown === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--muted);padding:24px">Версии не найдены</td>`;
      tbody.appendChild(tr);
    }
  }
  SK.app.launchVer = function (vid) {
    const acc = SK.storage.activeAccount();
    toast("Запуск Minecraft " + vid + " под аккаунтом " + (acc ? acc.name : "офлайн"));
    addJournal(`[launcher/INFO] Запуск версии ${escapeHtml(vid)} (автономный аккаунт: ${escapeHtml(acc ? acc.name : "—")})`, "info");
  };
  SK.app.installVer = function (vid) {
    toast("Скачивание версии " + vid + "…");
    addJournal(`[download/INFO] Скачивание версии ${escapeHtml(vid)}…`, "info");
    setTimeout(() => {
      const vers = SK.MC_VERSIONS.map(v => v.id === vid ? { ...v, installed: true } : v);
      SK.MC_VERSIONS = vers;
      renderVersions();
      toast("Версия " + vid + " установлена");
    }, 1200);
  };
  $("#ver-search").addEventListener("input", renderVersions);
  $$('input[name="vf"]').forEach(r => r.addEventListener("change", renderVersions));

  // ---------- View: MODS ----------
  let modSource = "modrinth";
  let selectedMod = null;
  function renderMods() {
    const source = modSource;
    const search = $("#mod-search").value.toLowerCase();
    const list = (source === "modrinth" ? SK.MODS_MODRINTH : SK.MODS_CURSEFORGE)
      .filter(m => !search || m.name.toLowerCase().includes(search) || m.authors.toLowerCase().includes(search));
    $("#mod-count").textContent = "(" + list.length + ")";
    const wrap = $("#mod-list");
    wrap.innerHTML = "";
    list.forEach(m => {
      const row = document.createElement("div");
      row.className = "mod-row" + (selectedMod && selectedMod.id === m.id && selectedMod.source === source ? " selected" : "");
      row.innerHTML = `
        <div class="mod-art">${m.icon}</div>
        <div class="mod-info">
          <div class="mod-row-name">${escapeHtml(m.name)}</div>
          <div class="mod-row-desc">${escapeHtml(m.summary)}</div>
          <div class="mod-row-meta"><span class="mod-badge">${escapeHtml(m.loader)}</span><span>⬇ ${escapeHtml(m.downloads)}</span></div>
        </div>
      `;
      row.onclick = () => openModDetail(m, source);
      wrap.appendChild(row);
    });
    $("#mod-empty").style.display = list.length ? "none" : "block";
  }
  function openModDetail(m, source) {
    selectedMod = { ...m, source };
    renderMods(); // refresh selection highlight
    const cover = $("#mod-cover");
    cover.innerHTML = m.icon; // emoji as cover for mock
    $("#mod-detail-name").textContent = m.name;
    $("#mod-detail-authors").textContent = m.authors;
    $("#mod-detail-downloads").textContent = m.downloads;
    $("#mod-detail-summary").textContent = m.summary;
    const versionsEl = $("#mod-versions");
    versionsEl.innerHTML = m.versions.map(v => `<span class="mod-badge">${escapeHtml(v)}</span>`).join("");
    const btn = $("#btn-install-mod");
    const installed = SK.storage.modsInstalled().some(x => x.id === m.id && x.source === source);
    btn.textContent = installed ? "Уже установлен" : "Установить мод";
    btn.disabled = installed;
    btn.onclick = () => {
      SK.storage.addModInstalled({ id: m.id, source, name: m.name, loader: m.loader });
      btn.textContent = "Уже установлен";
      btn.disabled = true;
      toast("Мод «" + m.name + "» установлен");
      addJournal(`[mod install/INFO] Установлен мод ${escapeHtml(m.name)} (${escapeHtml(source)})`, "success");
      renderMods();
    };
    $("#mod-detail").style.display = "flex";
  }
  $("#btn-close-mod").onclick = () => { $("#mod-detail").style.display = "none"; selectedMod = null; renderMods(); };
  $$(".mod-tab").forEach(tab => {
    tab.onclick = () => {
      $$(".mod-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      modSource = tab.dataset.source;
      selectedMod = null;
      $("#mod-detail").style.display = "none";
      renderMods();
    };
  });
  $("#mod-search").addEventListener("input", renderMods);

  // ---------- View: FILES ----------
  function renderFiles() {
    const tree = $("#file-tree");
    const tbody = $("#file-tbody");
    tree.innerHTML = "";
    tbody.innerHTML = "";
    SK.FILES.forEach((f, i) => {
      // tree
      const div = document.createElement("div");
      div.className = "file-row";
      div.innerHTML = `<span class="ic">${f.type === "folder" ? "📂" : "📄"}</span><div class="file-row-name">${escapeHtml(f.name)}</div><div class="file-row-meta"><span>${f.type}</span></div>`;
      div.onclick = () => toast("Открыта папка " + f.name);
      tree.appendChild(div);
      // list
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><span class="ic">${f.type === "folder" ? "📂" : "📄"}</span> <span class="file-row-name">${escapeHtml(f.name)}</span></td><td class="num">${escapeHtml(f.type)}</td><td class="num">${fmtSize(i * 1048576)}</td><td class="num">${escapeHtml(f.date)}</td><td class="num"><button class="btn btn-sm ghost">Открыть</button></td>`;
      tbody.appendChild(tr);
    });
    $("#file-count").textContent = SK.FILES.length + " элементов";
    $("#path-bar").textContent = "/.minecraft";
  }

  // ---------- View: JOURNAL ----------
  function renderJournal() {
    const consoleEl = $("#log-console");
    const empty = $("#log-wrap").querySelector(".log-empty");
    const lines = SK.JOURNAL_LINES;
    consoleEl.innerHTML = lines.map(l => `<div class="log-line${l.cls ? " " + l.cls : ""}">${escapeHtml(l.t)}</div>`).join("");
    consoleEl.scrollTop = consoleEl.scrollHeight;
    empty.style.display = lines.length ? "none" : "block";
  }
  function addJournal(text, cls) {
    SK.JOURNAL_LINES.push({ t: text, cls: cls || "" });
    if ($("#view-journal").style.display === "block") renderJournal();
  }
  $("#btn-copy-log").onclick = () => {
    const text = SK.JOURNAL_LINES.map(l => l.t).join("\n");
    navigator.clipboard.writeText(text).then(() => toast("Скопировано в буфер"));
  };
  $("#btn-clear-log").onclick = () => {
    SK.JOURNAL_LINES = [];
    renderJournal();
    toast("Журнал очищен");
  };
  $("#btn-save-log").onclick = () => {
    const blob = new Blob([SK.JOURNAL_LINES.map(l => l.t).join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "minecraft-journal.log";
    a.click();
    toast("Журнал сохранён");
  };

  // ---------- View: ACCOUNTS ----------
  function renderAccounts() {
    const grid = $("#accounts-grid");
    grid.innerHTML = "";
    SK.storage.accounts().forEach(acc => {
      const active = acc.id === SK.storage.activeAccount().id;
      const card = document.createElement("article");
      card.className = "acc-card" + (active ? " active" : "");
      card.innerHTML = `
        <div class="acc-header">
          <div class="acc-avatar">${acc.avatar}</div>
          ${active ? `<span style="color:var(--success);font-weight:800;font-size:11px">АКТИВЕН</span>` : ""}
        </div>
        <div class="acc-name">${escapeHtml(acc.name)}</div>
        <div class="acc-type">${escapeHtml(acc.type)}</div>
        <div class="acc-email">${acc.email ? escapeHtml(acc.email) : "нет привязки (офлайн)"}</div>
        <div class="acc-actions">
          <button class="btn primary" ${active ? "disabled" : ""} onclick="SK.app.setAcc('${escapeAttr(acc.id)}')">${active ? "Активно" : "Активировать"}</button>
          <button class="btn btn-sm ghost" onclick="SK.app.editAcc('${escapeAttr(acc.id)}')" title="Редактировать">✎</button>
          <button class="btn btn-sm ghost" onclick="SK.app.delAcc('${escapeAttr(acc.id)}')" title="Удалить" ${SK.storage.accounts().length <= 1 ? "disabled" : ""}>🗑</button>
        </div>
      `;
      grid.appendChild(card);
    });
    refreshAccountUI();
  }
  SK.app.setAcc = function (id) {
    SK.storage.setActive(id);
    renderAccounts();
    toast("Аккаунт активирован");
  };
  SK.app.editAcc = function (id) {
    const acc = SK.storage.accounts().find(a => a.id === id);
    if (!acc) return;
    openModal("Редактировать аккаунт", `
      <div class="acc-form">
        <div class="field">
          <label>Имя отображаемое</label>
          <input id="ed-acc-name" value="${escapeHtml(acc.name)}">
        </div>
        <div class="field">
          <label>Тип входа</label>
          <select id="ed-acc-type"><option value="Автономная">Автономная (офлайн)</option><option value="Microsoft">Microsoft</option></select>
        </div>
        <div class="field full">
          <label>Почта Microsoft (опционально)</label>
          <input id="ed-acc-email" value="${escapeHtml(acc.email || "")}" placeholder="example@mail.com">
        </div>
        <div class="field full">
          <label>Аватар</label>
          <div class="skin-pick" id="ed-skin-pick"></div>
        </div>
      </div>
    `, `
      <button class="btn outline" onclick="closeModal()">Отмена</button>
      <button class="btn primary" onclick="SK.app.saveAccEdit('${escapeAttr(id)}')">Сохранить</button>
    `);
    $("#ed-acc-type").value = acc.type;
    const skins = [
      { id: "default", label: "Стандарт", emoji: "👤", src: "" },
      { id: "steve", label: "Steve", emoji: "🧍", src: "" },
      { id: "alex", label: "Alex", emoji: "🏃‍♀️", src: "" },
      { id: "custom", label: "Свой скин", emoji: "🎨", src: "" },
    ];
    const pick = $("#ed-skin-pick");
    pick.innerHTML = skins.map(s => `<div class="skin-opt ${acc.skin === s.id ? "selected" : ""}" title="${s.label}" onclick="SK.app.pickSkin('${s.id}', this)">${s.emoji}</div>`).join("");
  };
  SK.app.pickSkin = function (skinId, el) {
    $$(".skin-opt", $("#ed-skin-pick")).forEach(o => o.classList.remove("selected"));
    el.classList.add("selected");
    SK.app._pendingSkin = skinId;
  };
  SK.app.saveAccEdit = function (id) {
    const accs = SK.storage.accounts().map(a => {
      if (a.id === id) {
        a.name = $("#ed-acc-name").value || a.name;
        a.type = $("#ed-acc-type").value;
        a.email = $("#ed-acc-email").value || "";
        if (SK.app._pendingSkin) a.skin = SK.app._pendingSkin;
        const av = { default: "👤", steve: "🧍", alex: "🏃‍♀️", custom: "🎨" }[a.skin] || "👤";
        a.avatar = av;
      }
      return a;
    });
    SK.storage.saveAccounts(accs);
    closeModal();
    renderAccounts();
    toast("Аккаунт обновлён");
  };
  SK.app.delAcc = function (id) {
    if (!confirm("Удалить аккаунт?")) return;
    const accs = SK.storage.accounts().filter(a => a.id !== id);
    SK.storage.saveAccounts(accs);
    if (SK.storage.activeAccount().id === id) SK.storage.setActive(accs[0]?.id);
    renderAccounts();
    toast("Аккаунт удалён");
  };
  SK.app.addAccount = function () {
    openModal("Новый автономный аккаунт", `
      <div class="acc-form">
        <div class="field">
          <label>Имя игрока</label>
          <input id="new-acc-name" placeholder="Например, Iekna">
        </div>
        <div class="field full">
          <label>Аватар</label>
          <div class="skin-pick" id="new-skin-pick"></div>
        </div>
      </div>
    `, `
      <button class="btn outline" onclick="closeModal()">Отмена</button>
      <button class="btn primary" onclick="SK.app.saveNewAcc()">Создать</button>
    `);
    const skins = [
      { id: "default", emoji: "👤" }, { id: "steve", emoji: "🧍" },
      { id: "alex", emoji: "🏃‍♀️" }, { id: "custom", emoji: "🎨" },
    ];
    $("#new-skin-pick").innerHTML = skins.map(s => `<div class="skin-opt" onclick="SK.app.pickSkin('${s.id}', this)">${s.emoji}</div>`).join("");
  };
  SK.app.saveNewAcc = function () {
    const name = $("#new-acc-name").value.trim();
    if (!name) { toast("Введите имя игрока"); return; }
    const accs = SK.storage.accounts();
    const skin = SK.app._pendingSkin || "default";
    const av = { default: "👤", steve: "🧍", alex: "🏃‍♀️", custom: "🎨" }[skin] || "👤";
    accs.push({ id: "acc-" + Date.now(), name, type: "Автономная", email: "", avatar: av, skin, active: false });
    SK.storage.saveAccounts(accs);
    closeModal();
    renderAccounts();
    toast("Аккаунт «" + name + "» создан");
  };

  // ---------- View: SETTINGS ----------
  const settingsTabs = [
    { id: "general", title: "Основное", icon: "🏠" },
    { id: "minecraft", title: "Minecraft", icon: "🟩" },
    { id: "java", title: "Java", icon: "☕" },
    { id: "accounts", title: "Учётные записи", icon: "👥" },
  ];
  let settingsTab = "general";
  function renderSettingsMenu() {
    const menu = $("#settings-menu");
    menu.innerHTML = settingsTabs.map(t => `
      <div class="sm-item ${settingsTab === t.id ? "active" : ""}" onclick="SK.app.setSettingsTab('${t.id}')">${t.icon} ${t.title}</div>
    `).join("");
  }
  function renderSettingsPanel() {
    const s = SK.storage.settings();
    const panel = $("#settings-panel");
    if (settingsTab === "general") {
      panel.innerHTML = `
        <div class="setting-group">
          <h3 class="sg-title">Оформление</h3>
          <div class="setting-row">
            <label>Тёмная тема оформления</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="st-theme" ${s.theme === "dark" ? "checked" : ""}> Включить тёмную тему</label></div>
          </div>
          <div class="setting-row">
            <label>Язык интерфейса</label>
            <div class="row-right"><select id="st-lang"><option value="ru">Русский</option><option value="en">English</option></select></div>
          </div>
          <div class="setting-row">
            <label>Показывать время игры в примерах</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="st-playtime" ${s.showPlaytime ? "checked" : ""}> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Закрывать лаунчер при запуске игры</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="st-close" ${s.closeLauncher ? "checked" : ""}> Включено</label></div>
          </div>
          <p class="sg-sub">Автономная учётная запись позволяет играть без подключения к серверам Mojang. Создай профиль в разделе «Автономный вход».</p>
        </div>
        <div class="setting-group" style="display:flex;gap:12px">
          <button class="btn primary" onclick="SK.app.saveSettings()">Сохранить настройки</button>
          <button class="btn outline" onclick="SK.app.resetSettings()">Сбросить</button>
        </div>
      `;
      $("#st-theme").addEventListener("change", (e) => { applyTheme(e.target.checked ? "dark" : "light"); });
      $("#st-lang").value = s.language;
    } else if (settingsTab === "minecraft") {
      panel.innerHTML = `
        <div class="setting-group">
          <h3 class="sg-title">Параметры окна игры</h3>
          <div class="setting-row">
            <label>Запускать Minecraft в полноэкранном режиме</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="mc-fullscreen"> Полный экран</label></div>
          </div>
          <div class="setting-row">
            <label>Размер окна</label>
            <div class="row-right" style="display:flex;align-items:center;gap:8px">
              <input type="number" id="mc-w" value="849" style="width:70px"> ×
              <input type="number" id="mc-h" value="480" style="width:70px"> <span style="color:var(--muted)">пиксели</span>
            </div>
          </div>
          <div class="setting-row">
            <label>Закрывать лаунчер при запуске окна игры</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="mc-close"> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Завершать работу лаунчера при закрытии окна игры</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="mc-exit"> Включено</label></div>
          </div>
          <p class="sg-sub">Эти параметры применяются при запуске автономной сессии.</p>
        </div>
        <div class="setting-group" style="display:flex;gap:12px">
          <button class="btn primary" onclick="SK.app.saveSettings()">Сохранить</button>
        </div>
      `;
    } else if (settingsTab === "java") {
      panel.innerHTML = `
        <div class="setting-group">
          <h3 class="sg-title">Установка Java</h3>
          <div class="setting-row">
            <label>Используемый файл Java</label>
            <div class="row-right" style="display:flex;align-items:center;gap:8px">
              <input type="text" id="java-path" value="${escapeHtml(s.javaPath)}" placeholder="Путь к java.exe/java">
              <button class="btn btn-sm outline" onclick="SK.app.browseJava()">Обзор</button>
            </div>
          </div>
          <div class="setting-row">
            <label>Проводить проверку совместимости Java</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="java-check" checked> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Запускать загрузку настройки Java при запуске</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="java-load"> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Автоопределение версии Java</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="java-auto" checked> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Автозагрузка Mojang Java</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="java-mojang" checked> Включено</label></div>
          </div>
          <button class="btn outline btn-sm" style="margin-top:10px" onclick="SK.app.testJava()">Проверить настройки</button>
        </div>
        <div class="setting-group">
          <h3 class="sg-title">Память</h3>
          <div class="setting-row memory-row">
            <label>Минимальное использование памяти:</label>
            <div class="row-right"><input type="text" id="mem-min" value="${s.minMem}"> <span class="mem-unit">(-Xms)</span></div>
          </div>
          <div class="setting-row memory-row">
            <label>Максимальное использование памяти:</label>
            <div class="row-right"><input type="text" id="mem-max" value="${s.maxMem}"> <span class="mem_unit">(-Xmx)</span></div>
          </div>
          <div class="setting-row memory-row">
            <label>Размер PermGen:</label>
            <div class="row-right"><input type="text" id="mem-perm" value="${s.permGen}"> <span class="mem_unit">(-XX:PermSize)</span></div>
          </div>
          <div class="setting-row">
            <label>Предупреждать при нехватке свободной памяти</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="mem-warn" checked> Включено</label></div>
          </div>
        </div>
        <div class="setting-group">
          <h3 class="sg-title">Аргументы Java</h3>
          <div class="setting-row">
            <label>Использовать Mojang optimized defaults</label>
            <div class="row-right"><label style="margin:0"><input type="checkbox" id="java-mojang-opt" checked> Включено</label></div>
          </div>
          <div class="setting-row">
            <label>Garbage collector preset:</label>
            <div class="row-right"><select id="java-gc"><option value="None">None</option><option value="G1GC">G1GC</option><option value="ZGC">ZGC</option></select></div>
          </div>
        </div>
        <div class="setting-group" style="display:flex;gap:12px">
          <button class="btn primary" onclick="SK.app.saveSettings()">Сохранить настройки Java</button>
        </div>
      `;
    } else if (settingsTab === "accounts") {
      renderAccountsMini(panel);
    }
  }
  function renderAccountsMini(container) {
    container.innerHTML = `
      <div class="setting-group">
        <h3 class="sg-title">Автономные учётные записи</h3>
        <div id="acc-mini-list"></div>
        <div style="margin-top:10px"><button class="btn primary" onclick="SK.app.addAccount()">+ Добавить аккаунт</button></div>
      </div>
    `;
    const list = container.querySelector("#acc-mini-list");
    list.innerHTML = "";
    SK.storage.accounts().forEach(acc => {
      const active = acc.id === SK.storage.activeAccount().id;
      const d = document.createElement("div");
      d.className = "setting-row";
      d.innerHTML = `<label style="display:flex;align-items:center;gap:10px;cursor:default"><span class="acc-avatar" style="width:30px;height:30px;font-size:15px">${acc.avatar}</span> <span style="flex:1">${escapeHtml(acc.name)}</span> <span class="acc-type" style="font-size:10px;padding:2px 7px">${escapeHtml(acc.type)}</span></label>
        <div class="row-right"><label style="margin:0"><input type="radio" name="acc-mini" ${active ? "checked" : ""} onchange="SK.app.setAcc('${escapeAttr(acc.id)}')"> Активный</label></div>`;
      list.appendChild(d);
    });
  }
  SK.app.setSettingsTab = function (id) {
    settingsTab = id;
    renderSettingsMenu();
    renderSettingsPanel();
  };
  SK.app.saveSettings = function () {
    const s = SK.storage.settings();
    if (settingsTab === "general") {
      s.theme = document.documentElement.getAttribute("data-theme");
      s.language = $("#st-lang").value;
      s.showPlaytime = $("#st-playtime").checked;
      s.closeLauncher = $("#st-close").checked;
    } else if (settingsTab === "minecraft") {
      // window size etc not stored in detail here for brevity
    } else if (settingsTab === "java") {
      s.javaPath = $("#java-path").value;
      s.minMem = $("#mem-min").value;
      s.maxMem = $("#mem-max").value;
      s.permGen = $("#mem-perm").value;
    }
    SK.storage.saveSettings(s);
    toast("Настройки сохранены");
  };
  SK.app.resetSettings = function () {
    if (confirm("Сбросить настройки к значениям по умолчанию?")) {
      SK.storage.saveSettings({ theme: "dark", javaPath: "", minMem: "512 MiB", maxMem: "8144 MiB", permGen: "128 MiB", offlineLogin: true, showPlaytime: true, closeLauncher: true, language: "ru" });
      applyTheme("dark");
      renderSettingsPanel();
      toast("Настройки сброшены");
    }
  };
  SK.app.browseJava = function () {
    toast("Выберите папку с Java в проводнике (демо)");
  };
  SK.app.testJava = function () {
    toast("Проверка настроек Java…");
    setTimeout(() => toast("Настройки Java корректны"), 700);
  };

  // ---------- init ----------
  function init() {
    const s = SK.storage.settings();
    applyTheme(s.theme);
    refreshAccountUI();
    SK.router.show(SK.router.current());

    $("#btn-theme").onclick = toggleTheme;
    $("#btn-play").onclick = () => {
      const inst = SK.storage.instances()[0];
      if (inst) SK.app.playInst(inst.id);
      else toast("Нет доступных примеров");
    };
    $("#btn-new-inst").onclick = () => toast("Создание примера в следующей версии");
    $("#btn-add-account").onclick = SK.app.addAccount;

    // expose
    window.SK.app = SK.app;
    SK.app.renderHome = renderHome;
    SK.app.renderVersions = renderVersions;
    SK.app.renderMods = renderMods;
    SK.app.renderFiles = renderFiles;
    SK.app.renderJournal = renderJournal;
    SK.app.renderAccounts = renderAccounts;
    SK.app.renderSettingsPanel = renderSettingsPanel;

    // initial renders for the home view (already shown by router)
    renderHome();
    renderSettingsMenu();
    renderSettingsPanel();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
