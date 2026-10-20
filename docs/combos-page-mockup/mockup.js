// Illustrative design data. These routes and values are not published Labatar combos.
const combos = [
  {
    id: "c1",
    character: "Avatar Aang",
    support: "Katara",
    starter: "5B",
    position: "Midscreen",
    damage: 302,
    editorDifficulty: 2,
    pips: 0,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "5B > 2F~A > 5A > 236B",
    title: "Reliable 5B conversion",
    pick: "A practical first route from a common grounded hit. It uses no pips and keeps the timing straightforward.",
    note: "Confirm the initial 5B before committing to the follow-up.",
  },
  {
    id: "c2",
    character: "Avatar Aang",
    support: "Katara",
    starter: "5B",
    position: "Midscreen",
    damage: 276,
    editorDifficulty: 3,
    pips: 1,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "5B > 2F~B > 214A > 236EX",
    title: "5B EX conversion",
  },
  {
    id: "c3",
    character: "Avatar Aang",
    support: "Katara",
    starter: "5B",
    position: "Fullscreen",
    damage: 258,
    editorDifficulty: 2,
    pips: 0,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "5B > 2F~A > j.B > 236B",
    title: "Fullscreen conversion",
    pick: "A simple response when the hit starts far away. No resource spend is required in this example.",
    note: "Watch the spacing before the air follow-up.",
  },
  {
    id: "c4",
    character: "Avatar Aang",
    support: "Katara",
    starter: "2A",
    position: "Corner",
    damage: 231,
    editorDifficulty: 2,
    pips: 0,
    flow: 0,
    counterhit: false,
    confirm: "Unknown",
    route: "2A > 5B > 2F~A > 236B",
    title: "Corner light starter",
    note: "Hitconfirm status has not been reviewed in this sample.",
  },
  {
    id: "c5",
    character: "Avatar Aang",
    support: "Katara",
    starter: "j.B",
    position: "Midscreen",
    damage: 354,
    editorDifficulty: 3,
    pips: 1,
    flow: 100,
    counterhit: false,
    confirm: "Yes",
    route: "j.B > 5B > 214A > 236EX",
    title: "Air hit follow-up",
    pick: "A distinct starter to add after the basic grounded route.",
    note: "Jump-in height changes the timing of the grounded hit.",
  },
  {
    id: "c6",
    character: "Avatar Aang",
    support: "Katara",
    starter: "5B",
    position: "Midscreen",
    damage: 321,
    editorDifficulty: 4,
    pips: 1,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "5B > 2F~A > 214B > 236EX",
    title: "Close spacing damage route",
    note: "More damage when the starting spacing allows the 214B follow-up.",
  },
  {
    id: "c7",
    character: "Avatar Aang",
    support: "Katara",
    starter: "5B",
    position: "Midscreen",
    damage: 340,
    editorDifficulty: 5,
    pips: 2,
    flow: 0,
    counterhit: true,
    confirm: "Yes",
    route: "5B > 2F~B > 214B > 236EX",
    title: "Counterhit damage route",
    note: "A larger resource commitment that requires a counterhit.",
  },
  {
    id: "c8",
    character: "Nightmare Korra",
    support: "Vaatu",
    starter: "5A",
    position: "Midscreen",
    damage: 268,
    editorDifficulty: 1,
    pips: 0,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "5A > 5B > 236A",
    title: "Korra basic confirm",
    pick: "A compact starting route for a common normal.",
    note: "Keep the first link steady before adding a resource spend.",
  },
  {
    id: "c9",
    character: "Azula",
    support: "Lo and Li",
    starter: "j.C",
    position: "Corner",
    damage: 381,
    editorDifficulty: 4,
    pips: 2,
    flow: 100,
    counterhit: true,
    confirm: "Unknown",
    route: "j.C > 5C > 214EX > 236B",
    title: "Corner counterhit route",
    note: "The initial conversion's confirm status is unknown.",
  },
  {
    id: "c10",
    character: "Avatar Aang",
    support: "Katara",
    starter: "2B!",
    position: "Midscreen",
    damage: 318,
    editorDifficulty: 3,
    pips: 0,
    flow: 0,
    counterhit: false,
    confirm: "Yes",
    route: "2B! > 5B > 236B",
    title: "2B crit conversion",
  },
];

const columns = [
  ["character", "Character"],
  ["support", "Support"],
  ["starter", "Starter"],
  ["title", "Combo name"],
  ["name", "My name"],
  ["source", "Source"],
  ["position", "Position"],
  ["damage", "Damage"],
  ["difficulty", "Difficulty"],
  ["pips", "Pips"],
  ["flow", "Flow"],
  ["counterhit", "CH"],
  ["confirm", "Confirm"],
  ["route", "Route"],
  ["pick", "Editor"],
  ["status", "My status"],
  ["dismissalReason", "Dismissal reason"],
  ["tags", "My tags"],
];

const emptyRawFilters = () => ({
  query: "",
  character: "all",
  support: "all",
  starter: "all",
  source: "all",
  position: "all",
  maxPips: "",
  maxFlow: "",
  minDamage: "",
  maxDifficulty: "",
  confirm: "all",
  counterhit: "all",
  status: "all",
  tag: "all",
});

const initialTab = globalThis.location?.search?.includes("tab=raw") ? "raw" : "gameplan";
const initialComposer = globalThis.location?.search?.includes("add=combo") ? { id: null } : null;
const initialPicker = globalThis.location?.search?.includes("picker=character")
  ? "character"
  : globalThis.location?.search?.includes("picker=support")
    ? "support"
    : null;
const state = {
  tab: initialTab,
  gameplanCharacter: "Avatar Aang",
  gameplanSupport: "Katara",
  gameplanStarter: "5B",
  picker: initialPicker,
  gameplanStatus: "all",
  gameplanTag: "all",
  selectedId: "c2",
  rawSelectedId: null,
  entries: {
    c1: {
      status: "Saved for later",
      role: "",
      condition: "",
      tags: [],
      note: "Try this editor pick when I revisit my 5B options.",
    },
    c2: {
      name: "Older 5B route",
      myDifficulty: 4,
      status: "Using",
      role: "Autopilot",
      condition: "Midscreen / near corner",
      tags: ["neutral", "legacy"],
      note: "My current 5B route.",
    },
    c3: {
      myDifficulty: 2,
      status: "Using",
      role: "Autopilot",
      condition: "Fullscreen",
      tags: ["fullscreen"],
      note: "My reliable route from far away.",
    },
    c4: {
      status: "Retired",
      role: "Autopilot",
      condition: "Corner",
      tags: ["corner"],
      note: "Kept for reference.",
    },
    c5: {
      myDifficulty: 4,
      status: "Learning",
      role: "Situational",
      condition: "High jump-in hit",
      tags: ["air hit"],
      note: "Practice the height-dependent timing.",
    },
    c6: {
      myDifficulty: 4,
      status: "Considering",
      role: "Situational",
      condition: "At close enough spacing for 214B",
      tags: ["spacing", "damage"],
      note: "More damage if the spacing allows it.",
    },
    c7: {
      myDifficulty: 5,
      status: "Learning",
      role: "Situational",
      condition: "High airborne counterhit",
      tags: ["height", "counterhit"],
      note: "Check launch height before committing.",
    },
    c9: {
      status: "Dismissed",
      role: "",
      condition: "",
      tags: [],
      note: "",
      dismissalReason: "The counterhit and resource cost make this a poor fit for me.",
    },
    c10: {
      status: "Maybe someday",
      role: "",
      condition: "",
      tags: [],
      note: "Try this crit route when I have time to revisit 2B.",
    },
  },
  rawReplacementId: null,
  raw: emptyRawFilters(),
  sortKey: "catalog",
  sortDir: "asc",
  shownColumns: new Set(columns.map(([key]) => key)),
  columnsOpen: false,
  toast: "",
  undo: null,
  composer: initialComposer,
  editorPreview: false,
  publisher: null,
  publisherPayload: null,
  storageWarning: "",
};

const app = document.getElementById("app");
const byId = (id) => combos.find((combo) => combo.id === id);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
const entry = (combo) => state.entries[combo.id];
const displayName = (combo) => entry(combo)?.name?.trim() || combo.title;
const difficultyNames = ["", "Very easy", "Easy", "Moderate", "Hard", "Very hard"];
const difficultyText = (rating) =>
  rating == null ? "Unrated" : `${rating}/5 · ${difficultyNames[rating]}`;
const effectiveDifficulty = (combo) => entry(combo)?.myDifficulty ?? combo.editorDifficulty;
const label = (text, type = "") => `<span class="badge ${type}">${esc(text)}</span>`;
const statusLabel = (status) => label(status, status.toLowerCase().replaceAll(" ", "-"));
const cost = (combo) => `${combo.pips} pips · ${combo.flow} flow`;
const emptyPersonalEntry = () => ({
  name: "",
  status: "",
  role: "",
  condition: "",
  tags: [],
  note: "",
  dismissalReason: "",
  myDifficulty: null,
});
const scoped = (combo) =>
  combo.character === state.gameplanCharacter && combo.support === state.gameplanSupport;
const scopedCombos = () => combos.filter(scoped);
const starterCombos = () =>
  scopedCombos().filter((combo) => combo.starter === state.gameplanStarter);
const starterEntries = () => starterCombos().filter((combo) => entry(combo)?.status);
const preferredStarterCombo = () =>
  starterEntries().find((combo) => entry(combo).status === "Using") ??
  starterEntries().find((combo) => entry(combo).status !== "Dismissed") ??
  starterCombos()[0];
const availableStarters = () => [...new Set(scopedCombos().map((combo) => combo.starter))];
const characterRoster = [
  "Aang",
  "Korra",
  "Nightmare Korra",
  "Zuko",
  "Katara",
  "Toph",
  "Sokka",
  "Azula",
  "Kyoshi",
  "Ozai",
  "Zaheer",
  "Avatar Aang",
];
const supportRoster = {
  Aang: ["Gyatso", "Appa", "Momo"],
  Korra: ["Naga", "Tonraq", "Raava"],
  "Nightmare Korra": ["Vaatu", "Dark Avatar Unalaq", "Dark Spirit"],
  Zuko: ["Mai", "Ran and Shaw", "June"],
  Katara: ["Kanna", "Master Pakku", "Hakoda"],
  Toph: ["Badgermole", "The Boulder", "The Hippo"],
  Sokka: ["Suki", "Master Piandao", "Princess Yue"],
  Azula: ["Lo and Li", "Joo Dee", "Ursa"],
  Kyoshi: ["Rangi", "Kelsang", "Yun"],
  Ozai: ["Firelord Sozin", "Imperial Firebender", "Admiral Zhao"],
  Zaheer: ["Ming-Hua", "P'Li", "Ghazan"],
  "Avatar Aang": ["Katara", "Roku", "Guru Pathik"],
};
const localCombosKey = "labatar-combos-page-mockup-local-v1";
const localCombos = () => combos.filter((combo) => combo.local);
const linkedMp4s = new Map();
function removeLinkedMp4(comboId) {
  const linked = linkedMp4s.get(comboId);
  if (linked) URL.revokeObjectURL(linked.url);
  linkedMp4s.delete(comboId);
}
const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

function restoreLocalCombos() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(localCombosKey) ?? "null");
    if (!saved || !Array.isArray(saved.combos)) return;
    for (const combo of saved.combos) {
      if (
        !combo ||
        !/^local-[a-z0-9-]+$/.test(combo.id) ||
        combos.some((existing) => existing.id === combo.id) ||
        !["character", "support", "starter", "position", "route", "title"].every(
          (key) => typeof combo[key] === "string" && combo[key].length > 0,
        ) ||
        !["damage", "pips", "flow"].every((key) => Number.isFinite(combo[key]) && combo[key] >= 0)
      )
        continue;
      combos.push({
        id: combo.id,
        character: combo.character,
        support: combo.support,
        starter: combo.starter,
        position: combo.position,
        route: combo.route,
        title: combo.title,
        damage: combo.damage,
        pips: combo.pips,
        flow: combo.flow,
        counterhit: Boolean(combo.counterhit),
        confirm: combo.confirm === "Yes" ? "Yes" : "Unknown",
        editorDifficulty: null,
        local: true,
        publishDraft: combo.publishDraft ?? null,
      });
      const item = saved.entries?.[combo.id];
      state.entries[combo.id] = {
        ...emptyPersonalEntry(),
        name: typeof item?.name === "string" ? item.name : "",
        status: [
          "Saved for later",
          "Maybe someday",
          "Considering",
          "Learning",
          "Using",
          "Retired",
          "Dismissed",
        ].includes(item?.status)
          ? item.status
          : "Considering",
        role: ["", "Autopilot", "Situational"].includes(item?.role) ? item.role : "",
        condition: typeof item?.condition === "string" ? item.condition : "",
        tags: Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === "string") : [],
        note: typeof item?.note === "string" ? item.note : "",
        dismissalReason: typeof item?.dismissalReason === "string" ? item.dismissalReason : "",
        myDifficulty: [1, 2, 3, 4, 5].includes(item?.myDifficulty) ? item.myDifficulty : null,
      };
    }
  } catch {
    state.storageWarning = "Local storage is unavailable; new combos will last only until reload.";
  }
}

function persistLocalCombos() {
  try {
    const own = localCombos();
    globalThis.localStorage?.setItem(
      localCombosKey,
      JSON.stringify({
        combos: own,
        entries: Object.fromEntries(own.map((combo) => [combo.id, state.entries[combo.id]])),
      }),
    );
    if (!globalThis.localStorage) throw new Error("Local storage unavailable");
    state.storageWarning = "";
  } catch {
    state.storageWarning = "Local storage is unavailable; new combos will last only until reload.";
  }
}
const portraitMeta = {
  "Avatar Aang": { id: "aang", initials: "AA" },
  "Nightmare Korra": { id: "korra", initials: "NK" },
  Azula: { id: "azula", initials: "AZ" },
  Katara: { id: "katara", initials: "K" },
  Vaatu: { id: "vaatu", initials: "V" },
  "Lo and Li": { id: "loli", initials: "L&L" },
};
const portraitOptions = (kind) =>
  kind === "character" ? characterRoster : (supportRoster[state.gameplanCharacter] ?? []);
const portraitArt = (name) => {
  const meta = portraitMeta[name] ?? {
    id: `tone-${[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5}`,
    initials: name
      .split(/[\s-]+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 3)
      .toUpperCase(),
  };
  return `<span class="portrait-art portrait-${meta.id}" aria-hidden="true"><span>${esc(meta.initials)}</span></span>`;
};
function portraitPicker(kind) {
  const selected = kind === "character" ? state.gameplanCharacter : state.gameplanSupport;
  const open = state.picker === kind;
  const title = kind === "character" ? "Character" : "Support";
  return `<div class="portrait-picker ${open ? "open" : ""}"><span class="picker-label">${title}</span><button type="button" class="portrait-trigger" data-action="toggle-picker" data-kind="${kind}" aria-expanded="${open}" aria-label="Choose ${title.toLowerCase()}: ${esc(selected)}">${portraitArt(selected)}<span class="portrait-trigger-name">${esc(selected)}</span><span class="picker-chevron" aria-hidden="true">⌄</span></button>
    ${
      open
        ? `<div class="portrait-popout" role="dialog" aria-label="Choose ${title.toLowerCase()}"><div class="portrait-popout-head"><strong>Choose ${title.toLowerCase()}</strong><button type="button" class="picker-close" data-action="close-picker" aria-label="Close ${title.toLowerCase()} picker">×</button></div><div class="portrait-grid">${portraitOptions(
            kind,
          )
            .map(
              (name) =>
                `<button type="button" class="portrait-option ${name === selected ? "selected" : ""}" data-action="pick-portrait" data-kind="${kind}" data-value="${esc(name)}" aria-pressed="${name === selected}">${portraitArt(name)}<span>${esc(name)}</span></button>`,
            )
            .join("")}</div></div>`
        : ""
    }</div>`;
}
const starterGroups = [
  ["crit", "Crits"],
  ["ground-normal", "Grounded normals"],
  ["ground-command", "Grounded command normals"],
  ["ground-special", "Grounded specials"],
  ["ground-ex", "Grounded EX specials"],
  ["ground-throw", "Grounded throws"],
  ["air-normal", "Air normals"],
  ["air-command", "Air command normals"],
  ["air-special", "Air specials"],
  ["air-ex", "Air EX specials"],
  ["air-throw", "Air throws"],
  ["other", "Other starters"],
];
function groupForStarter(starter) {
  if (starter.split("~", 1)[0].endsWith("!")) return "crit";
  const airborne = starter.startsWith("j.");
  const input = airborne ? starter.slice(2) : starter;
  const location = airborne ? "air" : "ground";
  if (input.endsWith("EX")) return `${location}-ex`;
  if (input.endsWith("TH")) return `${location}-throw`;
  if (airborne && /^[ABC]$/.test(input)) return "air-normal";
  if (!airborne && /^[25][ABC]$/.test(input)) return "ground-normal";
  if (airborne && /^[1-9][ABC]$/.test(input)) return "air-command";
  if (!airborne && /^[1-9][ABC]$/.test(input)) return "ground-command";
  return input ? `${location}-special` : "other";
}
const groupedStarters = () => {
  const starters = availableStarters().sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  return starterGroups
    .map(([id, name]) => ({
      name,
      items: starters.filter((starter) => groupForStarter(starter) === id),
    }))
    .filter((group) => group.items.length);
};
const allTags = () =>
  [...new Set(Object.values(state.entries).flatMap((item) => item.tags))].sort((a, b) =>
    a.localeCompare(b),
  );

function selectField(name, value, options, dataName, className = "filter-field") {
  return `<div class="${className}"><label for="${name}">${esc(name.replace(/([A-Z])/g, " $1"))}</label><select id="${name}" data-${dataName}="${name}">
    ${options.map(([optionValue, optionLabel]) => `<option value="${esc(optionValue)}" ${value === optionValue ? "selected" : ""}>${esc(optionLabel)}</option>`).join("")}
  </select></div>`;
}

function rawMatches(combo) {
  const filter = state.raw;
  const text =
    `${combo.title} ${entry(combo)?.name ?? ""} ${entry(combo)?.status === "Dismissed" ? (entry(combo)?.dismissalReason ?? "") : ""} ${combo.route} ${combo.character} ${combo.support}`.toLowerCase();
  if (filter.query.trim() && !text.includes(filter.query.trim().toLowerCase())) return false;
  if (filter.character !== "all" && combo.character !== filter.character) return false;
  if (filter.support !== "all" && combo.support !== filter.support) return false;
  if (filter.starter !== "all" && combo.starter !== filter.starter) return false;
  if (filter.source === "local" && !combo.local) return false;
  if (filter.source === "catalog" && combo.local) return false;
  if (filter.position !== "all" && combo.position !== filter.position) return false;
  if (filter.maxPips !== "" && combo.pips > Number(filter.maxPips)) return false;
  if (filter.maxFlow !== "" && combo.flow > Number(filter.maxFlow)) return false;
  if (filter.minDamage !== "" && combo.damage < Number(filter.minDamage)) return false;
  if (
    filter.maxDifficulty !== "" &&
    (effectiveDifficulty(combo) == null ||
      effectiveDifficulty(combo) > Number(filter.maxDifficulty))
  )
    return false;
  if (filter.confirm !== "all" && combo.confirm !== filter.confirm) return false;
  if (filter.counterhit !== "all" && combo.counterhit !== (filter.counterhit === "yes"))
    return false;
  if (filter.status === "untracked" && entry(combo)?.status) return false;
  if (
    filter.status !== "all" &&
    filter.status !== "untracked" &&
    entry(combo)?.status !== filter.status
  )
    return false;
  if (filter.tag !== "all" && !entry(combo)?.tags.includes(filter.tag)) return false;
  return true;
}

function rawResults() {
  const results = combos.filter(rawMatches);
  if (state.sortKey === "catalog") return results;
  const direction = state.sortDir === "asc" ? 1 : -1;
  return results.sort((left, right) => {
    const leftValue =
      state.sortKey === "status"
        ? (entry(left)?.status ?? "")
        : state.sortKey === "difficulty"
          ? effectiveDifficulty(left)
          : state.sortKey === "source"
            ? left.local
              ? "Local"
              : "Catalog"
            : state.sortKey === "dismissalReason"
              ? entry(left)?.status === "Dismissed"
                ? entry(left)?.dismissalReason
                : ""
              : state.sortKey === "name"
                ? (entry(left)?.name ?? "")
                : state.sortKey === "tags"
                  ? (entry(left)?.tags.join(", ") ?? "")
                  : left[state.sortKey];
    const rightValue =
      state.sortKey === "status"
        ? (entry(right)?.status ?? "")
        : state.sortKey === "difficulty"
          ? effectiveDifficulty(right)
          : state.sortKey === "source"
            ? right.local
              ? "Local"
              : "Catalog"
            : state.sortKey === "dismissalReason"
              ? entry(right)?.status === "Dismissed"
                ? entry(right)?.dismissalReason
                : ""
              : state.sortKey === "name"
                ? (entry(right)?.name ?? "")
                : state.sortKey === "tags"
                  ? (entry(right)?.tags.join(", ") ?? "")
                  : right[state.sortKey];
    if (leftValue == null || leftValue === "")
      return rightValue == null || rightValue === "" ? 0 : 1;
    if (rightValue == null || rightValue === "") return -1;
    return (
      direction *
      (typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue ?? "").localeCompare(String(rightValue ?? "")))
    );
  });
}

function statusCount(status) {
  return starterEntries().filter((combo) => entry(combo).status === status).length;
}

function savedRow(combo) {
  const item = entry(combo);
  return `<div class="saved-row ${state.selectedId === combo.id ? "selected" : ""}">
    <button type="button" class="saved-main" data-action="select" data-id="${combo.id}">
      <span class="row-top"><span class="card-heading"><span class="result-title">${esc(displayName(combo))}</span><span class="card-status-role">${statusLabel(item.status)}${item.role ? label(item.role, "role") : ""}</span>${combo.local ? label("Local", "local") : ""}</span><span class="card-damage"><strong>${combo.damage}</strong><small>damage</small></span></span>
      ${item.condition ? `<span class="route-condition"><strong>${esc(item.condition)}</strong></span>` : ""}
      <span class="row-route route">${esc(combo.route)}</span>
      ${item.status === "Dismissed" && item.dismissalReason ? `<span class="dismissal-summary">Why I dismissed it: ${esc(item.dismissalReason)}</span>` : ""}
      <span class="metrics"><span class="metric">${esc(combo.position)}</span><span class="metric">${cost(combo)}</span><span class="metric difficulty-chip">Difficulty ${esc(difficultyText(effectiveDifficulty(combo)))}</span></span>
      <span class="personal-tags">${item.tags.map((tag) => `<span class="user-tag"># ${esc(tag)}</span>`).join("")}</span>
    </button>${item.status === "Dismissed" ? `<button type="button" class="secondary row-action" data-action="reconsider" data-id="${combo.id}">Reconsider</button>` : ""}
  </div>`;
}

function renderGameplan() {
  const tracked = starterEntries();
  const saved = tracked.filter((combo) => entry(combo).status !== "Dismissed");
  const source =
    state.gameplanStatus === "Dismissed"
      ? tracked.filter((combo) => entry(combo).status === "Dismissed")
      : saved;
  const visible = source.filter(
    (combo) =>
      (state.gameplanStatus === "all" || entry(combo).status === state.gameplanStatus) &&
      (state.gameplanTag === "all" || entry(combo).tags.includes(state.gameplanTag)),
  );
  const statuses = [
    "Using",
    "Learning",
    "Considering",
    "Saved for later",
    "Maybe someday",
    "Retired",
  ];
  const filtered = state.gameplanStatus !== "all" || state.gameplanTag !== "all";
  const routeGroup = (role, description) => {
    const items = visible
      .filter(
        (combo) =>
          entry(combo).role === role && ["Using", "Learning"].includes(entry(combo).status),
      )
      .sort(
        (left, right) =>
          statuses.indexOf(entry(left).status) - statuses.indexOf(entry(right).status),
      );
    return `<div class="gameplan-group role-group"><div class="role-heading"><div class="section-label">${role} <small>${items.length}</small></div><p>${description}</p></div><div class="saved-list">${items.length ? items.map(savedRow).join("") : `<div class="role-empty">${filtered ? `No ${role.toLowerCase()} routes match this filter.` : role === "Autopilot" ? "No autopilot saved yet. Browse Raw to add one." : "No situational routes saved for this starter yet."}</div>`}</div></div>`;
  };
  const unassigned = visible.filter(
    (combo) => ["Using", "Learning"].includes(entry(combo).status) && !entry(combo).role,
  );
  const candidates = visible.filter((combo) =>
    ["Considering", "Saved for later"].includes(entry(combo).status),
  );
  const maybeSomeday = visible.filter((combo) => entry(combo).status === "Maybe someday");
  const retired = visible.filter((combo) => entry(combo).status === "Retired");
  const dismissed = visible.filter((combo) => entry(combo).status === "Dismissed");
  const activeGroups = !["all", "Using", "Learning"].includes(state.gameplanStatus)
    ? ""
    : routeGroup(
        "Autopilot",
        "Default routes for common hits. Add another when its screen coverage differs.",
      ) +
      routeGroup("Situational", "Choose these only when their stated condition is true.") +
      (unassigned.length
        ? `<div class="gameplan-group"><div class="section-label">Role not set <small>${unassigned.length}</small></div><p class="group-hint">Assign Autopilot or Situational in a combo's details.</p><div class="saved-list">${unassigned.map(savedRow).join("")}</div></div>`
        : "");
  const candidatesSection = candidates.length
    ? `<div class="gameplan-group candidate-group"><div class="section-label">Candidates <small>${candidates.length}</small></div><p class="group-hint">Saved for later is a bookmark. Considering means you're evaluating the route.</p><div class="saved-list">${candidates.map(savedRow).join("")}</div></div>`
    : "";
  const maybeSomedaySection = maybeSomeday.length
    ? `<div class="gameplan-group candidate-group"><div class="section-label">Maybe someday <small>${maybeSomeday.length}</small></div><p class="group-hint">Interesting routes with no near-term plan to try them.</p><div class="saved-list">${maybeSomeday.map(savedRow).join("")}</div></div>`
    : "";
  const retiredSection = retired.length
    ? `<div class="gameplan-group retired-group"><div class="section-label">Retired <small>${retired.length}</small></div><div class="saved-list">${retired.map(savedRow).join("")}</div></div>`
    : "";
  const dismissedSection = dismissed.length
    ? `<div class="gameplan-group dismissed-group"><div class="section-label">Dismissed <small>${dismissed.length}</small></div><p class="group-hint">Routes you reviewed and chose not to adopt.</p><div class="saved-list">${dismissed.map(savedRow).join("")}</div></div>`
    : "";
  return `<div class="gameplan-scope">${state.picker ? '<button type="button" class="picker-backdrop" data-action="close-picker" aria-label="Close portrait picker"></button>' : ""}<div class="scopebar">
      ${portraitPicker("character")}
      ${portraitPicker("support")}
      <div class="scope-meta"><span class="dot"></span> Personal workspace · sample catalog</div></div>
      <div class="starter-focus"><div><h2>${state.gameplanStarter ? `What do I do after <span>${esc(state.gameplanStarter)}</span>?` : "No combo starters for this pairing yet."}</h2></div>
        <div class="starter-groups" role="group" aria-label="Choose one starter">${
          groupedStarters()
            .map(
              (group) =>
                `<div class="starter-group"><div class="starter-group-label">${esc(group.name)}</div><div class="starter-buttons">${group.items.map((starter) => `<button type="button" class="starter-button ${starter === state.gameplanStarter ? "active" : ""}" data-action="gameplan-starter" data-starter="${esc(starter)}" aria-pressed="${starter === state.gameplanStarter}">${esc(starter)}</button>`).join("")}</div></div>`,
            )
            .join("") ||
          '<div class="no-starters">Choose another pairing, or inspect the sample catalog in Raw.</div>'
        }</div></div></div>
    <div class="workspace"><section class="main-panel"><div class="panel-head"><div class="gameplan-stats">${statuses.map((status) => `<div><strong>${statusCount(status)}</strong><span>${status}</span></div>`).join("")}</div></div>
      <div class="panel-body"><div class="gameplan-toolbar"><div class="status-pills">${[["all", "Gameplan"], ...statuses.map((status) => [status, status]), ["Dismissed", `Dismissed (${statusCount("Dismissed")})`]].map(([value, title]) => `<button type="button" class="pill ${state.gameplanStatus === value ? "active" : ""}" data-action="gameplan-status" data-value="${value}">${title}</button>`).join("")}</div><button type="button" class="primary" data-action="create-local">+ Add my combo</button></div>
        <div class="tag-filter"><span>My tags</span><button type="button" class="tag-chip ${state.gameplanTag === "all" ? "active" : ""}" data-action="gameplan-tag" data-value="all">All</button>${[
          ...new Set(source.flatMap((combo) => entry(combo).tags)),
        ]
          .sort((a, b) => a.localeCompare(b))
          .map(
            (tag) =>
              `<button type="button" class="tag-chip ${state.gameplanTag === tag ? "active" : ""}" data-action="gameplan-tag" data-value="${esc(tag)}"># ${esc(tag)}</button>`,
          )
          .join("")}</div>
        ${
          source.length
            ? visible.length
              ? `${activeGroups}${candidatesSection}${maybeSomedaySection}${retiredSection}${dismissedSection}`
              : '<div class="empty">No saved combo matches this tag or status.</div>'
            : `<div class="empty"><strong>${state.gameplanStatus === "Dismissed" ? "No dismissed routes for this starter." : state.gameplanStarter ? `No routes in your gameplan for ${esc(state.gameplanStarter)} yet.` : "No combos for this pairing yet."}</strong><br /><button type="button" class="text-button" data-action="create-local">Add my combo</button> or <button type="button" class="text-button" data-action="tab" data-tab="raw">browse Raw →</button>${state.gameplanStatus === "all" && tracked.some((combo) => entry(combo).status === "Dismissed") ? ' or <button type="button" class="text-button" data-action="gameplan-status" data-value="Dismissed">view dismissed routes</button>' : ""}.</div>`
        }
      </div></section>${renderDetail(state.selectedId, false)}</div>`;
}

function rawFilterSelect(name, value, options) {
  return selectField(name, value, options, "raw-filter");
}

function rawCell(combo, key) {
  if (key === "route") return `<span class="route raw-route">${esc(combo.route)}</span>`;
  if (key === "source") return combo.local ? label("Local", "local") : label("Catalog", "catalog");
  if (key === "name") return entry(combo)?.name ? esc(entry(combo).name) : "—";
  if (key === "difficulty")
    return effectiveDifficulty(combo) == null ? "—" : `${effectiveDifficulty(combo)}/5`;
  if (key === "counterhit") return combo.counterhit ? "Yes" : "No";
  if (key === "pick") return combo.pick ? label("Pick", "pick") : "—";
  if (key === "status") return entry(combo)?.status ? statusLabel(entry(combo).status) : "";
  if (key === "dismissalReason")
    return entry(combo)?.status === "Dismissed" && entry(combo).dismissalReason
      ? esc(entry(combo).dismissalReason)
      : "—";
  if (key === "tags")
    return (
      entry(combo)
        ?.tags.map((tag) => `<span class="user-tag"># ${esc(tag)}</span>`)
        .join(" ") || "—"
    );
  return esc(combo[key]);
}

function activeRawFilters() {
  const filter = state.raw;
  return Object.entries(filter)
    .filter(([, value]) => value !== "" && value !== "all")
    .map(
      ([key, value]) =>
        `${key.replace(/([A-Z])/g, " $1")}: ${key === "status" && value === "untracked" ? "No status" : value}`,
    );
}

function renderRaw() {
  const results = rawResults();
  const filter = state.raw;
  return `<section class="raw-panel"><div class="panel-head raw-head"><div><div class="panel-kicker">Raw / All combos</div><h2>Catalog and local combos.</h2><p class="panel-intro">Inspect the sample catalog alongside combos saved on this device.</p></div><div class="raw-head-actions"><button type="button" class="primary" data-action="create-local">+ Add my combo</button><div class="raw-total">${results.length}<span>of ${combos.length} combos</span></div></div></div>
    <div class="raw-controls"><div class="raw-search"><label for="raw-query">Search route, title, or name</label><input id="raw-query" data-raw-input="query" value="${esc(filter.query)}" placeholder="e.g. 5B > 2F or Korra" /></div>
      <div class="raw-filter-grid">
        ${rawFilterSelect("character", filter.character, [["all", "All characters"], ...[...new Set(combos.map((combo) => combo.character))].map((value) => [value, value])])}
        ${rawFilterSelect("support", filter.support, [["all", "All supports"], ...[...new Set(combos.map((combo) => combo.support))].map((value) => [value, value])])}
        ${rawFilterSelect("starter", filter.starter, [["all", "All starters"], ...[...new Set(combos.map((combo) => combo.starter))].map((value) => [value, value])])}
        ${rawFilterSelect("source", filter.source, [
          ["all", "Any source"],
          ["catalog", "Catalog"],
          ["local", "Local"],
        ])}
        ${rawFilterSelect("position", filter.position, [
          ["all", "All positions"],
          ["Midscreen", "Midscreen"],
          ["Fullscreen", "Fullscreen"],
          ["Corner", "Corner"],
        ])}
        ${rawFilterSelect("confirm", filter.confirm, [
          ["all", "Any / unknown"],
          ["Yes", "Reviewed: yes"],
          ["Unknown", "Unknown"],
        ])}
        ${rawFilterSelect("counterhit", filter.counterhit, [
          ["all", "Any CH"],
          ["yes", "Required"],
          ["no", "Not required"],
        ])}
        ${rawFilterSelect("status", filter.status, [
          ["all", "Any status"],
          ["Using", "Using"],
          ["Learning", "Learning"],
          ["Considering", "Considering"],
          ["Saved for later", "Saved for later"],
          ["Maybe someday", "Maybe someday"],
          ["Retired", "Retired"],
          ["Dismissed", "Dismissed"],
          ["untracked", "No status"],
        ])}
        ${rawFilterSelect("tag", filter.tag, [["all", "Any personal tag"], ...allTags().map((tag) => [tag, tag])])}
        <div class="filter-field"><label for="maxPips">Max pips</label><input id="maxPips" data-raw-input="maxPips" type="number" min="0" value="${esc(filter.maxPips)}" placeholder="Any" /></div>
        <div class="filter-field"><label for="maxFlow">Max flow</label><input id="maxFlow" data-raw-input="maxFlow" type="number" min="0" value="${esc(filter.maxFlow)}" placeholder="Any" /></div>
        <div class="filter-field"><label for="minDamage">Min damage</label><input id="minDamage" data-raw-input="minDamage" type="number" min="0" value="${esc(filter.minDamage)}" placeholder="Any" /></div>
        <div class="filter-field"><label for="maxDifficulty">Max difficulty</label><select id="maxDifficulty" data-raw-filter="maxDifficulty"><option value="">Any</option>${[1, 2, 3, 4, 5].map((rating) => `<option value="${rating}" ${filter.maxDifficulty === String(rating) ? "selected" : ""}>${rating}/5 or easier</option>`).join("")}</select></div>
      </div><div class="raw-filter-footer"><div class="applied">${
        activeRawFilters().length
          ? activeRawFilters()
              .map((item) => `<span>${esc(item)}</span>`)
              .join("")
          : "No filters · showing catalog and local combos"
      }</div><div><button type="button" class="text-button" data-action="clear-raw">Clear filters</button><button type="button" class="secondary" data-action="toggle-columns">Columns</button></div></div>
      ${state.columnsOpen ? `<div class="column-chooser"><span class="section-label">Visible columns</span>${columns.map(([key, title]) => `<label><input type="checkbox" data-column="${key}" ${state.shownColumns.has(key) ? "checked" : ""} /> ${title}</label>`).join("")}</div>` : ""}</div>
    <div class="raw-table-wrap"><table class="raw-table"><thead><tr>${columns
      .filter(([key]) => state.shownColumns.has(key))
      .map(
        ([key, title]) =>
          `<th scope="col"><button type="button" data-action="sort" data-key="${key}">${title}${state.sortKey === key ? (state.sortDir === "asc" ? " ↑" : " ↓") : ""}</button></th>`,
      )
      .join("")}</tr></thead>
      <tbody>${
        results.length
          ? results
              .map(
                (combo) =>
                  `<tr class="${state.rawSelectedId === combo.id ? "selected" : ""}" data-action="raw-select" data-id="${combo.id}" tabindex="0" aria-label="Open ${esc(displayName(combo))} details">${columns
                    .filter(([key]) => state.shownColumns.has(key))
                    .map(([key]) => `<td>${rawCell(combo, key)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")
          : `<tr><td colspan="${state.shownColumns.size}">No combos match these filters.</td></tr>`
      }</tbody></table></div>
    <div class="raw-footer"><span>Click a row to inspect, track, or compare it.</span><span>Sample catalog · ${combos.length - localCombos().length} / local · ${localCombos().length}</span></div>
    ${state.rawSelectedId ? `<div class="raw-inspector" id="raw-detail">${renderDetail(state.rawSelectedId, true)}</div>` : ""}</section>`;
}

function renderDetail(id, inRaw) {
  const combo = byId(id);
  if (!combo)
    return `<aside class="detail-panel"><div class="detail-body"><h2>Choose a combo</h2><p class="panel-intro">Its route, video area, editor reason, tags, and actions appear here.</p></div></aside>`;
  const item = entry(combo);
  const usingRoutes = inRaw
    ? combos.filter(
        (route) =>
          route.id !== combo.id &&
          route.character === combo.character &&
          route.support === combo.support &&
          route.starter === combo.starter &&
          entry(route)?.status === "Using",
      )
    : [];
  const old = usingRoutes.find((route) => route.id === state.rawReplacementId);
  const linkedMp4 = linkedMp4s.get(combo.id);
  return `<aside class="detail-panel" aria-label="Selected combo details"><div class="detail-top"><div class="panel-kicker">Selected combo · ${esc(combo.character)} / ${esc(combo.support)}</div><h2>${esc(displayName(combo))}</h2>${item?.name?.trim() && item.name.trim() !== combo.title ? `<p class="editor-name">${combo.local ? "Local name" : "Editor name"}: ${esc(combo.title)}</p>` : ""}
    <div class="detail-badges">${combo.local ? label("Local combo", "local") : ""}${combo.pick ? label("Editor's pick", "pick") : ""}${item?.status ? statusLabel(item.status) : ""}${label(`Hitconfirm: ${combo.confirm.toLowerCase()}`, combo.confirm === "Unknown" ? "unknown" : "")}</div></div>
    ${linkedMp4 ? `<video class="combo-video" data-local-video-player="${combo.id}" src="${esc(linkedMp4.url)}" controls playsinline preload="metadata" aria-label="Local MP4 for ${esc(displayName(combo))}"></video><p class="video-playback-error" data-video-error="${combo.id}" hidden>This MP4 could not be played here. Its codec may not be supported by your browser.</p>` : `<div class="video" role="img" aria-label="${combo.local ? "No clip linked to this local combo" : "Illustrative video placeholder"}">${combo.local ? '<span class="video-empty">No clip linked</span>' : '<span class="play" aria-hidden="true">▶</span>'}<span class="video-caption">${combo.local ? "Local combo · add a YouTube link before publishing" : "Combo clip preview · placeholder"}</span></div>`}
    <div class="detail-body"><div class="detail-section local-video-section"><h3>Local MP4</h3>${linkedMp4 ? `<p class="linked-video-name">${esc(linkedMp4.name)}</p>` : ""}<label for="local-video-${combo.id}">${linkedMp4 ? "Replace MP4" : "Choose MP4 to play"}</label><input id="local-video-${combo.id}" type="file" accept="video/mp4,.mp4" data-local-video-file="${combo.id}" />${linkedMp4 ? `<button type="button" class="text-button" data-action="remove-video" data-id="${combo.id}">Remove MP4</button>` : ""}<p class="field-hint">Selected files play here until this page is closed or reloaded.</p></div><div class="stat-grid"><div class="stat"><span class="stat-label">Damage</span><strong>${combo.damage}</strong></div><div class="stat"><span class="stat-label">Pips</span><strong>${combo.pips}</strong></div><div class="stat"><span class="stat-label">Flow</span><strong>${combo.flow}</strong></div></div>
      <div class="detail-section difficulty-section"><h3>Execution difficulty</h3><label for="my-difficulty-${combo.id}">My difficulty</label><select id="my-difficulty-${combo.id}" data-my-difficulty="${combo.id}"><option value="" ${item?.myDifficulty == null ? "selected" : ""}>${combo.editorDifficulty == null ? "No rating available" : `Use editor rating · ${esc(difficultyText(combo.editorDifficulty))}`}</option>${[1, 2, 3, 4, 5].map((rating) => `<option value="${rating}" ${item?.myDifficulty === rating ? "selected" : ""}>${esc(difficultyText(rating))}</option>`).join("")}</select></div>
      <div class="detail-section"><h3>Route</h3><div class="detail-route route">${esc(combo.route)}</div></div>
      ${combo.pick ? `<div class="detail-section"><h3>Why the editor picked it</h3><p>${esc(combo.pick)}</p></div>` : ""}
      <div class="detail-section"><h3>Editor notes</h3><p>${combo.note ? esc(combo.note) : combo.local ? "This private combo has no editor notes." : "No editor notes for this combo."}</p></div>
      ${
        item?.status
          ? `<div class="detail-section personal-section"><h3>My tracking</h3><label for="name-${combo.id}">My name (optional)</label><input id="name-${combo.id}" data-entry-name="${combo.id}" maxlength="80" value="${esc(item.name ?? "")}" placeholder="${esc(combo.title)}" /><p class="field-hint">Leave blank to use the ${combo.local ? "local" : "editor"} name.</p>
        <div class="tracking-primary-fields"><div class="tracking-field"><label for="status-${combo.id}">Status</label><select id="status-${combo.id}" data-entry-status="${combo.id}">${["Saved for later", "Maybe someday", "Considering", "Learning", "Using", "Retired", "Dismissed"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
        ${
          ["Saved for later", "Maybe someday", "Dismissed"].includes(item.status)
            ? ""
            : `<div class="tracking-field"><label for="role-${combo.id}">Role for this starter</label><select id="role-${combo.id}" data-entry-role="${combo.id}">${[
                ["", "Not assigned"],
                ["Autopilot", "Autopilot"],
                ["Situational", "Situational"],
              ]
                .map(
                  ([role, title]) =>
                    `<option value="${role}" ${(item.role ?? "") === role ? "selected" : ""}>${title}</option>`,
                )
                .join("")}</select></div>`
        }</div>
        ${["Saved for later", "Maybe someday", "Dismissed"].includes(item.status) ? "" : `<label for="condition-${combo.id}">When I use it</label><input id="condition-${combo.id}" data-entry-condition="${combo.id}" maxlength="80" value="${esc(item.condition ?? "")}" placeholder="e.g. fullscreen, high hit, max spacing" />`}
        <label>My tags</label><div class="editable-tags">${item.tags.length ? item.tags.map((tag) => `<button type="button" class="user-tag removable" data-action="remove-tag" data-id="${combo.id}" data-tag="${esc(tag)}" aria-label="Remove ${esc(tag)} tag"># ${esc(tag)} ×</button>`).join("") : '<span class="subtext">No tags yet.</span>'}</div>
        <form class="tag-form" data-tag-form="${combo.id}"><input name="tag" aria-label="New personal tag" maxlength="24" placeholder="Add a tag" /><button type="submit" class="secondary">Add</button></form>
        <label for="note-${combo.id}">Personal note</label><textarea id="note-${combo.id}" data-entry-note="${combo.id}" rows="2" placeholder="When do you use this?">${esc(item.note)}</textarea>${item.status === "Dismissed" ? `<label for="dismissal-reason-${combo.id}">Why I dismissed it (optional)</label><textarea id="dismissal-reason-${combo.id}" data-dismissal-reason="${combo.id}" rows="2" placeholder="Why doesn't this route fit your plan?">${esc(item.dismissalReason ?? "")}</textarea>` : ""}</div>`
          : `<div class="detail-section"><h3>Personal tracking</h3><p>Save it for later, or dismiss it if you've decided against using it.</p></div>`
      }
      ${
        usingRoutes.length
          ? `<div class="detail-section replacement-section"><h3>Replace a route I'm using</h3><label for="replace-${combo.id}">Current route</label><select id="replace-${combo.id}" data-raw-replacement="${combo.id}"><option value="">Choose a route to replace</option>${usingRoutes.map((route) => `<option value="${route.id}" ${old?.id === route.id ? "selected" : ""}>${esc(displayName(route))} · ${esc(route.position)}</option>`).join("")}</select>${old ? `<div class="replacement-compare"><strong>Current: ${esc(displayName(old))}</strong><span class="route">${esc(old.route)}</span><span>${esc(old.position)} · ${old.damage} damage · ${cost(old)}</span><span>This route: ${esc(combo.position)} · ${combo.damage} damage · ${cost(combo)}</span><span>${combo.damage - old.damage >= 0 ? "+" : ""}${combo.damage - old.damage} damage; check position and resource differences before replacing.</span></div><button type="button" class="primary" data-action="replace" data-id="${combo.id}">Use instead</button>` : ""}</div>`
          : ""
      }
      ${
        combo.local
          ? `<div class="detail-section local-publication"><h3>Local combo</h3><p>Saved on this device. You can use it in your gameplan without publishing it.</p><div class="button-row"><button type="button" class="secondary" data-action="edit-local" data-id="${combo.id}">Edit combo</button><button type="button" class="text-button" data-action="delete-local" data-id="${combo.id}">Delete local combo</button></div><div class="publication-divider"><label class="editor-preview"><input type="checkbox" data-editor-preview ${state.editorPreview ? "checked" : ""} /> Preview editor access</label><p class="field-hint">Mockup control. The real backend verifies editor sign-in.</p>${state.editorPreview ? `<button type="button" class="primary" data-action="prepare-publisher" data-id="${combo.id}">Prepare backend submission</button>` : ""}</div></div>`
          : ""
      }
      <div class="button-row">${!item?.status ? `<button type="button" class="primary" data-action="save" data-id="${combo.id}">Save for later</button><button type="button" class="secondary" data-action="dismiss" data-id="${combo.id}">Dismiss</button>` : ""}
        ${item?.status === "Dismissed" ? `<button type="button" class="primary" data-action="reconsider" data-id="${combo.id}">Reconsider</button>` : ""}
      </div><p class="detail-note">${combo.local ? "This combo and its tracking are stored in this browser. No backend submission happens in the mockup." : "Illustrative catalog data. Changes to its tracking reset when this file reloads."}</p></div></aside>`;
}

function saveLocalCombo(form) {
  const values = new FormData(form);
  const field = (name) => {
    const value = values.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const character = field("character");
  const support = field("support");
  const title = field("title");
  const starter = field("starter");
  const route = field("route");
  const damage = Number(field("damage"));
  const pips = Number(field("pips"));
  const flow = Number(field("flow"));
  const error = form.querySelector(".form-error");
  if (!characterRoster.includes(character) || !supportRoster[character]?.includes(support)) {
    error.textContent = "Choose a character and one of that character's supports.";
    return false;
  }
  if (
    !title ||
    !starter ||
    !route ||
    ![damage, pips, flow].every((value) => Number.isInteger(value) && value >= 0)
  ) {
    error.textContent = "Add a name, starter, route, and whole-number damage and costs.";
    return false;
  }
  const existing = state.composer?.id ? byId(state.composer.id) : null;
  const id =
    existing?.id ?? `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const combo = {
    id,
    local: true,
    character,
    support,
    starter,
    title,
    route,
    position: field("position"),
    damage,
    pips,
    flow,
    counterhit: values.has("counterhit"),
    confirm: field("confirm") === "Yes" ? "Yes" : "Unknown",
    editorDifficulty: null,
  };
  if (existing) Object.assign(existing, combo);
  else combos.push(combo);
  const prior = state.entries[id] ?? emptyPersonalEntry();
  state.entries[id] = {
    ...prior,
    status: field("status"),
    role: field("role"),
    condition: field("condition"),
    note: field("note"),
    myDifficulty: field("myDifficulty") ? Number(field("myDifficulty")) : null,
  };
  state.composer = null;
  state.publisherPayload = null;
  state.gameplanCharacter = character;
  state.gameplanSupport = support;
  state.gameplanStarter = starter;
  state.gameplanStatus = "all";
  state.gameplanTag = "all";
  state.selectedId = id;
  if (state.tab === "raw") {
    state.raw = emptyRawFilters();
    state.rawSelectedId = id;
  }
  persistLocalCombos();
  state.toast = state.storageWarning || (existing ? "Local combo updated." : "Local combo saved.");
  return true;
}

function validYouTubeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
      return false;
    const id = ["youtu.be", "www.youtu.be"].includes(url.hostname)
      ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
        ? url.pathname === "/watch"
          ? url.searchParams.get("v")
          : /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
        : null;
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "");
  } catch {
    return false;
  }
}

function preparePublisherPayload(form) {
  const combo = byId(state.publisher);
  if (!combo?.local || !state.editorPreview) return false;
  const values = new FormData(form);
  const field = (name) => {
    const value = values.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const backendId = field("backendId");
  const youtubeUrl = field("youtubeUrl");
  const moveIds = field("moveIds")
    .split(/\r?\n/)
    .map((id) => id.trim())
    .filter(Boolean);
  const editorNote = field("editorNote");
  const error = form.querySelector(".form-error");
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(backendId)) {
    error.textContent = "Use a lowercase backend ID with letters, numbers, and hyphens.";
    return false;
  }
  if (!validYouTubeUrl(youtubeUrl)) {
    error.textContent = "Add a valid HTTPS link to a single YouTube video.";
    return false;
  }
  if (moveIds.length > 100 || moveIds.some((id) => !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id))) {
    error.textContent = "Move IDs must be lowercase slugs, one per line (up to 100).";
    return false;
  }
  combo.publishDraft = {
    backendId,
    youtubeUrl,
    moveIds: field("moveIds"),
    editorNote,
    routingMode: field("routingMode"),
  };
  state.publisherPayload = {
    id: backendId,
    characterId: slug(combo.character),
    supportId: slug(combo.support),
    route: combo.route,
    routingMode: field("routingMode"),
    moveIds,
    screenPosition: combo.position,
    damage: String(combo.damage),
    resourceCosts: { pips: combo.pips, flow: combo.flow },
    mechanics: [
      ...(combo.counterhit ? ["Requires counterhit"] : []),
      ...(combo.confirm === "Yes" ? ["Initial conversion hitconfirmable"] : []),
    ],
    notes: editorNote ? [editorNote] : [],
    youtubeUrl,
    startSeconds: 0,
  };
  persistLocalCombos();
  state.toast = "Public payload ready for review. No backend request was sent.";
  return true;
}

function renderComposer() {
  if (!state.composer) return "";
  const combo = state.composer.id ? byId(state.composer.id) : null;
  const item = combo ? entry(combo) : emptyPersonalEntry();
  const character = combo?.character ?? state.gameplanCharacter;
  const support = combo?.support ?? state.gameplanSupport;
  const starter = combo?.starter ?? state.gameplanStarter;
  return `<div class="modal-backdrop" data-action="close-composer"><div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="composer-title"><div class="modal-head"><div><span class="panel-kicker">Private workspace</span><h2 id="composer-title">${combo ? "Edit my combo" : "Add my combo"}</h2><p>Save a route on this device and track it alongside catalog combos.</p></div><button type="button" class="secondary" data-action="close-composer" aria-label="Close combo form">×</button></div>
    <form class="combo-form" data-local-combo-form><div class="form-grid"><label>Character<input name="character" list="local-characters" required maxlength="80" value="${esc(character)}" /></label><label>Support<input name="support" list="local-supports" required maxlength="80" value="${esc(support)}" /></label><label>Starter<input name="starter" required maxlength="40" value="${esc(starter)}" placeholder="5B" /></label><label>Combo name<input name="title" required maxlength="80" value="${esc(combo?.title ?? "")}" placeholder="My fullscreen route" /></label><label class="full">Route<textarea name="route" required maxlength="2000" rows="2" placeholder="5B > 2F~A > 5A > 236B">${esc(combo?.route ?? "")}</textarea></label><label>Screen position<select name="position">${["Midscreen", "Fullscreen", "Corner"].map((position) => `<option value="${position}" ${position === (combo?.position ?? "Midscreen") ? "selected" : ""}>${position}</option>`).join("")}</select></label><label>Damage<input name="damage" type="number" required min="0" step="1" value="${esc(combo?.damage ?? "")}" placeholder="302" /></label><label>Pips<input name="pips" type="number" required min="0" step="1" value="${esc(combo?.pips ?? 0)}" /></label><label>Flow<input name="flow" type="number" required min="0" step="1" value="${esc(combo?.flow ?? 0)}" /></label><label>My difficulty<select name="myDifficulty"><option value="">Not rated</option>${[1, 2, 3, 4, 5].map((rating) => `<option value="${rating}" ${item.myDifficulty === rating ? "selected" : ""}>${esc(difficultyText(rating))}</option>`).join("")}</select></label><label>Hitconfirm<select name="confirm"><option value="Unknown">Unknown</option><option value="Yes" ${combo?.confirm === "Yes" ? "selected" : ""}>Yes</option></select></label><label>Status<select name="status">${["Considering", "Saved for later", "Maybe someday", "Learning", "Using", "Retired", "Dismissed"].map((status) => `<option value="${status}" ${status === (item.status || "Considering") ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>Role<select name="role">${[
      ["", "Not assigned"],
      ["Autopilot", "Autopilot"],
      ["Situational", "Situational"],
    ]
      .map(
        ([value, title]) =>
          `<option value="${value}" ${value === (item.role || "") ? "selected" : ""}>${title}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="full">When I use it<input name="condition" maxlength="80" value="${esc(item.condition ?? "")}" placeholder="e.g. high hit, near corner" /></label><label class="full">Personal note<textarea name="note" rows="2" maxlength="1000" placeholder="Optional private note">${esc(item.note ?? "")}</textarea></label></div><label class="check-field"><input name="counterhit" type="checkbox" ${combo?.counterhit ? "checked" : ""} /> Requires counterhit</label><p class="form-error" role="alert"></p>${state.storageWarning ? `<p class="storage-warning">${esc(state.storageWarning)}</p>` : ""}<div class="modal-actions"><button type="button" class="secondary" data-action="close-composer">Cancel</button><button type="submit" class="primary">${combo ? "Save changes" : "Save local combo"}</button></div></form>
    <datalist id="local-characters">${characterRoster.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist><datalist id="local-supports">${[...new Set(Object.values(supportRoster).flat())].map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></div></div>`;
}

function renderPublisher() {
  const combo = state.publisher ? byId(state.publisher) : null;
  if (!combo?.local || !state.editorPreview) return "";
  const draft = combo.publishDraft ?? {};
  return `<div class="modal-backdrop" data-action="close-publisher"><div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="publisher-title"><div class="modal-head"><div><span class="panel-kicker">Editor preview · mockup only</span><h2 id="publisher-title">Prepare backend submission</h2><p>Review public fields before an authenticated editor publishes this route.</p></div><button type="button" class="secondary" data-action="close-publisher" aria-label="Close submission form">×</button></div><form class="combo-form" data-publisher-form><div class="form-grid"><label>Backend combo ID<input name="backendId" required pattern="[a-z0-9][a-z0-9-]*" maxlength="100" value="${esc(draft.backendId ?? slug(`${combo.character}-${combo.support}-${combo.title}`))}" /></label><label>Routing mode<select name="routingMode"><option value="autopilot" ${draft.routingMode !== "unique" ? "selected" : ""}>Autopilot</option><option value="unique" ${draft.routingMode === "unique" ? "selected" : ""}>Unique routing</option></select></label><label class="full">YouTube URL<input name="youtubeUrl" type="url" required value="${esc(draft.youtubeUrl ?? "")}" placeholder="https://www.youtube.com/watch?v=..." /></label><label class="full">Published move IDs, one per line<textarea name="moveIds" rows="3" placeholder="aang-5b">${esc(draft.moveIds ?? "")}</textarea></label><label class="full">Editor notes for the published combo<textarea name="editorNote" rows="2" maxlength="1000" placeholder="Optional public note">${esc(draft.editorNote ?? "")}</textarea></label></div><p class="publication-caveat">This backend currently requires a YouTube video and does not store combo names, personal ratings, status, tags, or personal notes. Those stay local.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="secondary" data-action="close-publisher">Cancel</button><button type="submit" class="primary">Preview payload</button></div></form>${state.publisherPayload ? `<div class="payload-review"><h3>Exact public payload</h3><pre>${esc(JSON.stringify(state.publisherPayload, null, 2))}</pre><div class="modal-actions"><button type="button" class="secondary" data-action="download-publisher">Download publisher draft</button><button type="button" class="primary" data-action="simulate-submit">Simulate backend submit</button></div><p>No request is sent from this standalone mockup. Approved editors can import the draft in the existing publisher.</p></div>` : ""}</div></div>`;
}

function render() {
  app.innerHTML = `<div class="shell ${state.tab === "raw" ? "raw-view" : "gameplan-view"}"><header class="topbar"><div class="brand"><span class="brand-mark">L</span> LABATAR <span style="color:#657181;font-weight:500">/</span> COMBOS</div><div class="top-links"><span>Match history</span><span>Tech</span><strong>Combos</strong></div></header>
    <main class="page"><div class="page-heading">${state.tab === "raw" ? '<div><div class="eyebrow">Catalog + local / Raw data</div><h1>All combos.</h1><p class="lede">Inspect catalog routes and combos saved on this device.</p></div>' : ""}<span class="concept-tag">Interactive concept · sample data</span></div>
    <nav class="tasks two-tabs" aria-label="Combo views"><button type="button" class="task ${state.tab === "gameplan" ? "active" : ""}" data-action="tab" data-tab="gameplan" aria-current="${state.tab === "gameplan" ? "page" : "false"}"><span class="task-name">My gameplan</span></button><button type="button" class="task ${state.tab === "raw" ? "active" : ""}" data-action="tab" data-tab="raw" aria-current="${state.tab === "raw" ? "page" : "false"}"><span class="task-name">Raw</span></button></nav>
    ${state.tab === "gameplan" ? renderGameplan() : renderRaw()}</main>
    ${renderComposer()}${renderPublisher()}
    ${state.toast ? `<div class="toast" role="status">${esc(state.toast)}${state.undo ? '<button type="button" data-action="undo">Undo</button>' : ""}</div>` : ""}</div>`;
}

function selectGameplanScope(kind, value) {
  if (kind === "character") {
    state.gameplanCharacter = value;
    state.gameplanSupport =
      combos.find((combo) => combo.character === value)?.support ?? supportRoster[value]?.[0] ?? "";
  } else {
    state.gameplanSupport = value;
  }
  state.gameplanStarter = availableStarters()[0] ?? "";
  state.gameplanTag = "all";
  state.gameplanStatus = "all";
  state.picker = null;
  state.selectedId = preferredStarterCombo()?.id ?? null;
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.classList.contains("modal-backdrop") && event.target !== target) return;
  const action = target.dataset.action;
  if (action === "create-local") {
    state.composer = { id: null };
    state.publisher = null;
    state.publisherPayload = null;
  }
  if (action === "edit-local" && byId(target.dataset.id)?.local)
    state.composer = { id: target.dataset.id };
  if (action === "close-composer") state.composer = null;
  if (action === "prepare-publisher" && state.editorPreview && byId(target.dataset.id)?.local) {
    state.publisher = target.dataset.id;
    state.publisherPayload = null;
  }
  if (action === "close-publisher") {
    state.publisher = null;
    state.publisherPayload = null;
  }
  if (action === "delete-local") {
    const combo = byId(target.dataset.id);
    if (combo?.local && confirm(`Delete your local combo “${displayName(combo)}”?`)) {
      removeLinkedMp4(combo.id);
      combos.splice(combos.indexOf(combo), 1);
      delete state.entries[combo.id];
      if (state.selectedId === combo.id) state.selectedId = preferredStarterCombo()?.id ?? null;
      if (state.rawSelectedId === combo.id) state.rawSelectedId = null;
      if (state.publisher === combo.id) state.publisher = null;
      state.toast = "Local combo deleted.";
    }
  }
  if (action === "remove-video" && byId(target.dataset.id)) {
    removeLinkedMp4(target.dataset.id);
    state.toast = "Local MP4 removed.";
  }
  if (action === "download-publisher" && state.publisherPayload) {
    const payload = state.publisherPayload;
    const draft = {
      schemaVersion: 1,
      source: "labatar-combos-page-mockup",
      combo: payload,
      warnings: [
        "Review the fields in the editor publisher before publishing.",
        ...(payload.moveIds.length ? [] : ["Link published move IDs before publishing."]),
        "Combo name and private tracking are not part of the current backend schema.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${payload.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    state.toast = "Publisher draft downloaded. Import it in the editor publisher.";
  }
  if (action === "simulate-submit" && state.publisherPayload) {
    state.publisher = null;
    state.publisherPayload = null;
    state.toast = "Submission preview complete. No backend request was sent.";
  }
  if (action === "tab") {
    state.tab = target.dataset.tab;
    state.picker = null;
    state.toast = "";
  }
  if (action === "select") state.selectedId = target.dataset.id;
  if (action === "raw-select") {
    state.rawSelectedId = target.dataset.id;
    state.rawReplacementId = null;
  }
  if (action === "gameplan-status") state.gameplanStatus = target.dataset.value;
  if (action === "gameplan-tag") state.gameplanTag = target.dataset.value;
  if (action === "toggle-picker")
    state.picker = state.picker === target.dataset.kind ? null : target.dataset.kind;
  if (action === "close-picker") state.picker = null;
  if (
    action === "pick-portrait" &&
    portraitOptions(target.dataset.kind).includes(target.dataset.value)
  )
    selectGameplanScope(target.dataset.kind, target.dataset.value);
  if (action === "gameplan-starter" && availableStarters().includes(target.dataset.starter)) {
    state.gameplanStarter = target.dataset.starter;
    state.gameplanTag = "all";
    state.gameplanStatus = "all";
    state.selectedId = preferredStarterCombo()?.id ?? null;
  }
  if (action === "clear-raw") {
    state.raw = emptyRawFilters();
    state.rawSelectedId = null;
    state.rawReplacementId = null;
  }
  if (action === "toggle-columns") state.columnsOpen = !state.columnsOpen;
  if (action === "sort") {
    const key = target.dataset.key;
    state.sortDir = state.sortKey === key && state.sortDir === "asc" ? "desc" : "asc";
    state.sortKey = key;
  }
  if (action === "save") {
    const id = target.dataset.id;
    state.entries[id] = {
      ...(state.entries[id] ?? emptyPersonalEntry()),
      status: "Saved for later",
    };
    state.toast = `${byId(id).title} saved for later.`;
  }
  if (action === "dismiss") {
    const id = target.dataset.id;
    state.entries[id] = {
      ...(state.entries[id] ?? emptyPersonalEntry()),
      status: "Dismissed",
    };
    state.toast = `${byId(id).title} dismissed. Find it in Raw or the Dismissed filter.`;
  }
  if (action === "reconsider" && state.entries[target.dataset.id]) {
    state.entries[target.dataset.id].status = "Considering";
    if (state.tab === "gameplan") state.gameplanStatus = "all";
    state.toast = "Route moved to Considering.";
  }
  if (action === "remove-tag") {
    const item = state.entries[target.dataset.id];
    if (item) item.tags = item.tags.filter((tag) => tag !== target.dataset.tag);
    state.toast = "Tag removed.";
  }
  if (action === "replace" && state.tab === "raw" && state.rawReplacementId) {
    const oldId = state.rawReplacementId;
    const newId = target.dataset.id;
    const oldCombo = byId(oldId);
    const newCombo = byId(newId);
    if (
      !oldCombo ||
      !newCombo ||
      newId !== state.rawSelectedId ||
      oldId === newId ||
      entry(oldCombo)?.status !== "Using" ||
      oldCombo.character !== newCombo.character ||
      oldCombo.support !== newCombo.support ||
      oldCombo.starter !== newCombo.starter
    ) {
      state.rawReplacementId = null;
      render();
      return;
    }
    state.undo = {
      oldId,
      newId,
      old: structuredClone(state.entries[oldId]),
      next: state.entries[newId] ? structuredClone(state.entries[newId]) : null,
    };
    state.entries[oldId] = { ...state.entries[oldId], status: "Retired" };
    state.entries[newId] = {
      ...(state.entries[newId] ?? emptyPersonalEntry()),
      role: state.undo.old.role,
      condition: state.undo.old.condition,
      status: "Using",
    };
    state.gameplanStatus = "all";
    state.rawReplacementId = null;
    state.toast = "Replacement saved: old route retired, new route using.";
  }
  if (action === "undo" && state.undo) {
    const { oldId, newId, old, next } = state.undo;
    state.entries[oldId] = old;
    if (next) state.entries[newId] = next;
    else delete state.entries[newId];
    state.undo = null;
    state.toast = "Replacement undone.";
  }
  persistLocalCombos();
  render();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.localVideoFile) {
    const file = target.files?.[0];
    if (!file || !byId(target.dataset.localVideoFile)) return;
    if (!/\.mp4$/i.test(file.name)) {
      state.toast = "Choose an MP4 file.";
      render();
      return;
    }
    removeLinkedMp4(target.dataset.localVideoFile);
    linkedMp4s.set(target.dataset.localVideoFile, {
      name: file.name,
      url: URL.createObjectURL(file),
    });
    state.toast = `${file.name} ready to play.`;
    render();
    return;
  }
  if (target.closest("[data-publisher-form]")) {
    state.publisherPayload = null;
    target.closest(".modal-card")?.querySelector(".payload-review")?.remove();
    return;
  }
  if (target.closest("[data-local-combo-form]")) return;
  if (target.dataset.editorPreview !== undefined) {
    state.editorPreview = target.checked;
    if (!state.editorPreview) {
      state.publisher = null;
      state.publisherPayload = null;
    }
  }
  if (target.dataset.myDifficulty) {
    const id = target.dataset.myDifficulty;
    const rating = target.value === "" ? null : Number(target.value);
    if (rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      state.entries[id] ??= emptyPersonalEntry();
      state.entries[id].myDifficulty = rating;
      state.toast =
        rating === null ? "Personal difficulty cleared." : "Personal difficulty updated.";
    }
  }
  if (target.dataset.rawReplacement) state.rawReplacementId = target.value || null;
  if (target.dataset.rawFilter) {
    state.raw[target.dataset.rawFilter] = target.value;
    state.rawSelectedId = null;
    state.rawReplacementId = null;
  }
  if (target.dataset.rawInput) {
    state.raw[target.dataset.rawInput] = target.value;
    state.rawSelectedId = null;
    state.rawReplacementId = null;
  }
  if (target.dataset.entryStatus) {
    const oldStatus = state.entries[target.dataset.entryStatus].status;
    state.entries[target.dataset.entryStatus].status = target.value;
    if (state.tab === "gameplan") {
      if (target.value === "Dismissed") state.gameplanStatus = "Dismissed";
      else if (oldStatus === "Dismissed") state.gameplanStatus = "all";
    }
    state.toast = `Status changed to ${target.value.toLowerCase()}.`;
  }
  if (target.dataset.entryName) {
    state.entries[target.dataset.entryName].name = target.value.trim();
    state.toast = "Personal name updated.";
  }
  if (target.dataset.entryRole) {
    state.entries[target.dataset.entryRole].role = target.value;
    state.toast = `Role changed to ${target.value.toLowerCase()}.`;
  }
  if (target.dataset.entryCondition) {
    state.entries[target.dataset.entryCondition].condition = target.value.trim();
    state.toast = "Use condition updated.";
  }
  if (target.dataset.entryNote) {
    state.entries[target.dataset.entryNote].note = target.value;
    state.toast = "Personal note updated.";
  }
  if (target.dataset.dismissalReason) {
    state.entries[target.dataset.dismissalReason].dismissalReason = target.value.trim();
    state.toast = "Dismissal reason updated.";
  }
  if (target.dataset.column) {
    if (target.checked) state.shownColumns.add(target.dataset.column);
    else if (state.shownColumns.size > 1) state.shownColumns.delete(target.dataset.column);
  }
  persistLocalCombos();
  render();
});

app.addEventListener(
  "error",
  (event) => {
    const comboId = event.target?.dataset?.localVideoPlayer;
    if (comboId) {
      const message = app.querySelector(`[data-video-error="${comboId}"]`);
      if (message) message.hidden = false;
    }
  },
  true,
);

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.closest("[data-publisher-form]")) {
    state.publisherPayload = null;
    target.closest(".modal-card")?.querySelector(".payload-review")?.remove();
    return;
  }
  if (!target.dataset.rawInput) return;
  state.raw[target.dataset.rawInput] = target.value;
  state.rawSelectedId = null;
  state.rawReplacementId = null;
  const cursor = target.type === "text" ? target.selectionStart : null;
  render();
  const next = document.getElementById(target.id);
  next?.focus();
  if (cursor !== null && next?.setSelectionRange) next.setSelectionRange(cursor, cursor);
});

app.addEventListener("submit", (event) => {
  if (event.target.matches("[data-local-combo-form]")) {
    event.preventDefault();
    if (saveLocalCombo(event.target)) render();
    return;
  }
  if (event.target.matches("[data-publisher-form]")) {
    event.preventDefault();
    if (preparePublisherPayload(event.target)) render();
    return;
  }
  const form = event.target.closest("[data-tag-form]");
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.tagForm;
  const tag = form.elements.tag.value.trim().replace(/^#\s*/, "").toLowerCase();
  if (tag && state.entries[id] && !state.entries[id].tags.includes(tag)) {
    state.entries[id].tags.push(tag);
    state.toast = `Added #${tag} tag.`;
  }
  persistLocalCombos();
  render();
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (state.composer || state.publisher)) {
    state.composer = null;
    state.publisher = null;
    state.publisherPayload = null;
    render();
    return;
  }
  if (event.key === "Escape" && state.picker) {
    state.picker = null;
    render();
    return;
  }
  if (event.key === "Enter" && event.target.matches("tr[data-action='raw-select']")) {
    state.rawSelectedId = event.target.dataset.id;
    state.rawReplacementId = null;
    render();
  }
});

restoreLocalCombos();
render();
