const endpoint = "/v1/editor/access-roles";
const form = document.querySelector("#access-form");
const emailInput = document.querySelector("#email");
const roleInput = document.querySelector("#role");
const people = document.querySelector("#people");
const owner = document.querySelector("#owner");
const message = document.querySelector("#message");
const refresh = document.querySelector("#refresh");
const testDiscordAlert = document.querySelector("#test-discord-alert");

function showMessage(value, error = false) {
  message.textContent = value;
  message.classList.toggle("error", error);
}

async function api(method, body, path = endpoint) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Labatar-Admin": "1" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function loadPeople() {
  const result = await api("GET");
  owner.textContent = `${result.owner} is the owner. Owner access is managed separately.`;
  people.replaceChildren();
  for (const entry of result.items) {
    const row = document.createElement("tr");
    const address = document.createElement("td");
    address.textContent = entry.email;
    const role = document.createElement("td");
    role.textContent = entry.role === "editor" ? "Editor + uploader" : "Uploader";
    const actions = document.createElement("td");
    const change = document.createElement("button");
    change.type = "button";
    change.className = "secondary";
    change.textContent = "Change";
    change.addEventListener("click", () => {
      emailInput.value = entry.email;
      roleInput.value = entry.role;
      emailInput.focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.style.marginLeft = "8px";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove access for ${entry.email}?`)) return;
      remove.disabled = true;
      try {
        await api("DELETE", { email: entry.email });
        await loadPeople();
        showMessage(`Removed ${entry.email}.`);
      } catch (error) {
        showMessage(error.message, true);
        remove.disabled = false;
      }
    });
    actions.append(change, remove);
    row.append(address, role, actions);
    people.append(row);
  }
  if (!result.items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No additional people yet.";
    row.append(cell);
    people.append(row);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const email = emailInput.value.trim();
    const role = roleInput.value;
    await api("PUT", { email, role });
    await loadPeople();
    showMessage(`Saved ${email} as ${role}.`);
    form.reset();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

refresh.addEventListener("click", async () => {
  try {
    await loadPeople();
    showMessage("Access list refreshed.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

testDiscordAlert.addEventListener("click", async () => {
  testDiscordAlert.disabled = true;
  try {
    await api("POST", undefined, "/v1/editor/discord-alert-test");
    showMessage("Test alert sent. Check your private Discord channel.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    testDiscordAlert.disabled = false;
  }
});

loadPeople().catch((error) => showMessage(error.message, true));
