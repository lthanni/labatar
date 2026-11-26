const CONTROLLER_BUTTONS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Start", "Back"];
const COMBO_ACTIONS = [
  "Atk1",
  "Atk2",
  "Atk3",
  "Atk4",
  "DashShortcut",
  "SuperShortcut",
  "ThrowShortcut",
  "GuardReversalShortcut",
];

const DEFAULT_COMBO_INPUT_BINDINGS = Object.freeze({
  X: "Atk1",
  Y: "Atk2",
  B: "Atk3",
  A: "Atk4",
  RB: "DashShortcut",
  RT: "SuperShortcut",
  LB: "ThrowShortcut",
  LT: "GuardReversalShortcut",
});

function validateComboInputBindings(value, { allowLegacy = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Controller bindings must be a button-to-action map.");
  }
  const bindings = {};
  for (const [button, action] of Object.entries(value)) {
    if (
      !CONTROLLER_BUTTONS.includes(button) ||
      (!COMBO_ACTIONS.includes(action) &&
        !(allowLegacy && typeof action === "string" && /^\w{1,40}$/.test(action)))
    ) {
      throw new Error(`Invalid controller binding for ${button}.`);
    }
    bindings[button] = action;
  }
  return bindings;
}

module.exports = {
  CONTROLLER_BUTTONS,
  COMBO_ACTIONS,
  DEFAULT_COMBO_INPUT_BINDINGS,
  validateComboInputBindings,
};
