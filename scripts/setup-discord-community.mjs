#!/usr/bin/env node

// Run from the repository root with --dry-run or --apply.
// Credentials are loaded from the ignored .env.discord.local file.
import { loadEnvFile } from "node:process";

const mode = process.argv[2] ?? "--dry-run";
if (!["--dry-run", "--apply"].includes(mode) || process.argv.length > 3) {
  console.error("Usage: node scripts/setup-discord-community.mjs [--dry-run|--apply]");
  process.exit(2);
}

try {
  loadEnvFile(".env.discord.local");
} catch {
  console.error("Missing .env.discord.local in the repository root.");
  process.exit(2);
}

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !/^\d{17,20}$/.test(guildId ?? "")) {
  console.error("Set DISCORD_BOT_TOKEN and a numeric DISCORD_GUILD_ID in .env.discord.local.");
  process.exit(2);
}

const API = "https://discord.com/api/v10";
const SEND_MESSAGES = 1n << 11n;
const MANAGE_CHANNELS = 1n << 4n;
const VIEW_CHANNEL = 1n << 10n;
const CHANNEL_TEXT = 0;
const CHANNEL_CATEGORY = 4;
const CHANNEL_FORUM = 15;

const desired = [
  {
    name: "start-here",
    type: CHANNEL_TEXT,
    topic:
      "Welcome to Labatar. Read the rules, find help, and learn where to share replays and feedback.",
    readOnly: true,
  },
  {
    name: "announcements",
    type: CHANNEL_TEXT,
    topic: "Labatar releases, important updates, and service notices.",
    readOnly: true,
  },
  {
    name: "help",
    type: CHANNEL_FORUM,
    topic:
      "Ask a Labatar question. Include your app version and enough detail for someone to reproduce the issue.",
    tags: ["Replays", "OBS", "Recordings", "YouTube", "Combos"],
  },
  {
    name: "bug-reports",
    type: CHANNEL_FORUM,
    topic:
      "Report a Labatar bug. Include what happened, what you expected, your app version, and steps to reproduce.",
    tags: ["Desktop App", "Catalog", "Recording", "Other"],
  },
  {
    name: "ideas",
    type: CHANNEL_FORUM,
    topic:
      "Suggest a Labatar improvement. One idea per post keeps discussion and updates easy to follow.",
    tags: ["App", "Catalog", "Community", "Other"],
  },
  {
    name: "replays-and-combos",
    type: CHANNEL_FORUM,
    topic:
      "Share replays and combo discoveries for discussion. Submit catalog entries through the Labatar app.",
    tags: ["Replay", "Combo", "Question", "Showcase"],
  },
];

async function discord(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const options = {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/lthanni/labatar, 0.4.2)",
      },
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`${API}${path}`, options);
    const data = await response.json().catch(() => null);
    if (response.status === 429 && attempt < 3) {
      const seconds = Number(data?.retry_after ?? response.headers.get("retry-after") ?? 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, seconds * 1000)));
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Discord ${method} ${path.split("/").slice(0, 3).join("/")}: HTTP ${response.status}, ${data?.message ?? "request failed"}${data?.code ? ` (${data.code})` : ""}`,
      );
    }
    return data;
  }
}

function channelLabel(channel) {
  return channel.type === CHANNEL_FORUM ? "forum" : "text";
}

async function main() {
  const [bot, guild, guilds, channels] = await Promise.all([
    discord("GET", "/users/@me"),
    discord("GET", `/guilds/${guildId}`),
    discord("GET", "/users/@me/guilds"),
    discord("GET", `/guilds/${guildId}/channels`),
  ]);
  const membership = guilds.find((item) => item.id === guildId);
  if (!membership) throw new Error("The bot is not installed in the configured server.");
  const permissions = BigInt(membership.permissions);
  for (const [name, bit] of [
    ["Manage Channels", MANAGE_CHANNELS],
    ["View Channels", VIEW_CHANNEL],
    ["Send Messages", SEND_MESSAGES],
  ]) {
    if ((permissions & bit) === 0n) throw new Error(`The bot needs the ${name} permission.`);
  }
  if (!guild.features.includes("COMMUNITY")) {
    throw new Error(
      "Enable Community in Discord Server Settings before creating the forum channels.",
    );
  }

  const parent = channels.find(
    (item) => item.type === CHANNEL_CATEGORY && item.name === "Text Channels",
  );
  if (!parent) throw new Error("The existing Text Channels category was not found.");

  const byName = new Map(channels.map((channel) => [channel.name.toLowerCase(), channel]));
  console.log(`Server: ${guild.name}; bot: ${bot.username}; mode: ${mode}`);
  for (const spec of desired) {
    const existing = byName.get(spec.name);
    if (existing && existing.type !== spec.type) {
      throw new Error(
        `#${spec.name} already exists as a different channel type; no changes made to it.`,
      );
    }
    if (existing) {
      console.log(`Keep #${spec.name} (${channelLabel(spec)})`);
      continue;
    }
    if (mode === "--dry-run") {
      console.log(
        `Create #${spec.name} (${channelLabel(spec)}${spec.readOnly ? ", read-only" : ""})`,
      );
      continue;
    }

    const payload = {
      name: spec.name,
      type: spec.type,
      parent_id: parent.id,
      topic: spec.topic,
    };
    if (spec.tags) payload.available_tags = spec.tags.map((name) => ({ name }));
    if (spec.readOnly) {
      payload.permission_overwrites = [
        { id: guildId, type: 0, deny: SEND_MESSAGES.toString() },
        { id: bot.id, type: 1, allow: SEND_MESSAGES.toString() },
      ];
    }

    const created = await discord("POST", `/guilds/${guildId}/channels`, payload);
    byName.set(spec.name, created);
    console.log(
      `Created #${spec.name} (${channelLabel(spec)}${spec.readOnly ? ", read-only" : ""})`,
    );
  }

  if (mode !== "--apply") return;
  const mention = (name) => {
    const channel = byName.get(name);
    return channel ? `<#${channel.id}>` : `#${name}`;
  };
  const intro = [
    "Welcome to Labatar!",
    `Read ${mention("rules")} first. Chat in ${mention("general")}, ask questions in ${mention("help")}, report problems in ${mention("bug-reports")}, and share ideas in ${mention("ideas")}.`,
    `Discuss discoveries in ${mention("replays-and-combos")}. To add a combo to the public catalog, submit it through the Labatar app.`,
  ].join("\n\n");
  const announcementsIntro = `Labatar releases and important updates will appear here. Discuss them in ${mention("general")} or suggest improvements in ${mention("ideas")}.`;
  for (const [name, content] of [
    ["start-here", intro],
    ["announcements", announcementsIntro],
  ]) {
    const channel = byName.get(name);
    if (channels.some((existing) => existing.id === channel.id)) continue;
    await discord("POST", `/channels/${channel.id}/messages`, {
      content,
      allowed_mentions: { parse: [] },
    });
    console.log(`Posted introduction in #${name}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
