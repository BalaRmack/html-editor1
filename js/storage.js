/* ================= SkyLauncher — localStorage persistence ================= */
window.SK = window.SK || {};

SK.storage = (function () {
  const PREFIX = "skylauncher_";
  function key(k) { return PREFIX + k; }

  function get(k, def) {
    try {
      const raw = localStorage.getItem(key(k));
      return raw === null ? def : JSON.parse(raw);
    } catch (e) { return def; }
  }
  function set(k, v) {
    try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {}
    return v;
  }

  // Accounts
  function accounts() {
    const stored = get("accounts");
    if (Array.isArray(stored) && stored.length) return stored;
    const def = SK.ACCOUNTS_DEFAULTS.map(a => ({ ...a }));
    set("accounts", def);
    return def;
  }
  function saveAccounts(list) { return set("accounts", list); }
  function activeAccount() {
    const accs = accounts();
    let cur = get("activeAccountId");
    if (!cur || !accs.find(a => a.id === cur)) cur = (accs.find(a => a.active) || accs[0] || {}).id;
    set("activeAccountId", cur);
    return accs.find(a => a.id === cur) || accs[0] || null;
  }
  function setActive(id) {
    const accs = accounts().map(a => ({ ...a, active: a.id === id }));
    set("accounts", accs);
    set("activeAccountId", id);
    return accs.find(a => a.id === id);
  }

  // Instances
  function instances() {
    const stored = get("instances");
    if (stored) return stored;
    set("instances", SK.INSTANCES);
    return SK.INSTANCES;
  }
  function saveInstances(list) { return set("instances", list); }

  // Settings
  function settings() {
    const def = {
      theme: "dark",
      javaPath: "",
      minMem: "512 MiB",
      maxMem: "8144 MiB",
      permGen: "128 MiB",
      offlineLogin: true,
      showPlaytime: true,
      closeLauncher: true,
      language: "ru",
    };
    return get("settings", def);
  }
  function saveSettings(s) { return set("settings", s); }

  // Misc
  function modsInstalled() { return get("modsInstalled", []); }
  function addModInstalled(mod) {
    const list = modsInstalled();
    if (!list.some(m => m.id === mod.id && m.source === mod.source)) list.push(mod);
    return set("modsInstalled", list);
  }

  return { get, set, accounts, saveAccounts, activeAccount, setActive,
           instances, saveInstances, settings, saveSettings,
           modsInstalled, addModInstalled };
})();
