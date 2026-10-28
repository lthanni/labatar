import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateAlert } from "../src/discord-alerts.mjs";
import { handleRequest } from "../src/worker.mjs";

const webhook = "https://discord.com/api/webhooks/123/token";
const path = "https://api.example.com/v1/editor/discord-alert-test";
const owner = async () => "owner@example.com";
const denied = async () => {
  throw new Error("Denied.");
};

function sendTest(headers = { "X-Labatar-Admin": "1" }) {
  return new Request(path, { method: "POST", headers });
}

function route(request, env, getAdmin = owner, fetchDiscord = fetch) {
  return handleRequest(
    request,
    { DB: {}, ...env },
    {},
    undefined,
    undefined,
    getAdmin,
    undefined,
    fetchDiscord,
  );
}

void test("only the owner can send a test alert, and Discord delivery is reported", async () => {
  const sent = [];
  const fetchDiscord = async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(null, { status: 204 });
  };
  assert.equal(
    (await route(sendTest(), { DISCORD_ALERT_WEBHOOK_URL: webhook }, denied, fetchDiscord)).status,
    403,
  );
  assert.equal(
    (await route(sendTest({}), { DISCORD_ALERT_WEBHOOK_URL: webhook }, owner, fetchDiscord)).status,
    400,
  );
  assert.equal(
    (
      await route(
        sendTest({ "X-Labatar-Admin": "1", Origin: "https://evil.example" }),
        { DISCORD_ALERT_WEBHOOK_URL: webhook },
        owner,
        fetchDiscord,
      )
    ).status,
    400,
  );
  assert.equal((await route(sendTest(), {}, owner, fetchDiscord)).status, 503);
  assert.equal(sent.length, 0);
  const response = await route(
    sendTest(),
    { DISCORD_ALERT_WEBHOOK_URL: webhook },
    owner,
    fetchDiscord,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, webhook);
  assert.match(sent[0].body.content, /test alert/);
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] });
});

void test("the test alert rejects an invalid webhook and reports Discord errors", async () => {
  let calls = 0;
  const fetchDiscord = async () => {
    calls += 1;
    return new Response(null, { status: 429 });
  };
  const invalid = await route(
    sendTest(),
    { DISCORD_ALERT_WEBHOOK_URL: "https://example.com/api/webhooks/123/token" },
    owner,
    fetchDiscord,
  );
  assert.equal(invalid.status, 502);
  assert.equal(calls, 0);
  const rejected = await route(
    sendTest(),
    { DISCORD_ALERT_WEBHOOK_URL: webhook },
    owner,
    fetchDiscord,
  );
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: "Discord rejected the alert (429)." });
  const unreachable = await route(
    sendTest(),
    { DISCORD_ALERT_WEBHOOK_URL: webhook },
    owner,
    async () => {
      throw new Error("network error with secret URL");
    },
  );
  assert.deepEqual(await unreachable.json(), { error: "Could not reach Discord." });
});

void test("candidate alert keeps a long route within Discord's message limit", () => {
  const content = candidateAlert({
    id: "candidate-id",
    combo: { characterId: "aang", supportId: "katara", route: "5B > ".repeat(400) },
  });
  assert.ok(content.length < 2000);
  assert.match(content, /Candidate ID: candidate-id/);
  assert.match(content, /\.\.\./);
});
