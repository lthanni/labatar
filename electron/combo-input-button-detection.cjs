const { CONTROLLER_BUTTONS } = require("./combo-input-bindings.cjs");
const { startComboInputClient } = require("./combo-input-client.cjs");

function cancelledError() {
  return Object.assign(new Error("Controller button detection cancelled."), { name: "AbortError" });
}

async function detectComboInputButton({
  signal,
  timeoutMs = 15000,
  startClient = startComboInputClient,
} = {}) {
  if (signal?.aborted) throw cancelledError();
  let previous = null;
  let armed = false;
  let resolvePress;
  let rejectPress;
  const pressed = new Promise((resolve, reject) => {
    resolvePress = resolve;
    rejectPress = reject;
  });
  // A worker may fail during startup, before the detection promise is awaited.
  void pressed.catch(() => undefined);
  const onState = (state) => {
    if (!Array.isArray(state?.buttons)) return;
    const buttons = state.buttons.filter((button) => CONTROLLER_BUTTONS.includes(button));
    if (previous === null) {
      armed = buttons.length === 0;
    } else {
      if (buttons.length === 0) armed = true;
      const newlyPressed = buttons.find((button) => !previous.includes(button));
      if (armed && newlyPressed) resolvePress(newlyPressed);
    }
    previous = buttons;
  };
  const abort = () => rejectPress(cancelledError());
  signal?.addEventListener("abort", abort, { once: true });
  let client;
  let timer;
  try {
    client = await startClient({ onState, onError: rejectPress, signal });
    if (signal?.aborted) throw cancelledError();
    timer = setTimeout(
      () => rejectPress(new Error("No controller button was pressed in time.")),
      timeoutMs,
    );
    return await pressed;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await client?.stop();
  }
}

module.exports = { detectComboInputButton };
