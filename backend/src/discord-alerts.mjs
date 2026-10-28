function webhookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Discord alert webhook is not configured correctly.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    !/^\/api\/webhooks\/\d+\/[^/]+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Discord alert webhook is not configured correctly.");
  }
  return url;
}

export async function sendDiscordAlert(env, content, fetcher = fetch) {
  if (!env.DISCORD_ALERT_WEBHOOK_URL) throw new Error("Discord alert webhook is not configured.");
  const url = webhookUrl(env.DISCORD_ALERT_WEBHOOK_URL);
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Could not reach Discord.");
  }
  if (!response.ok) throw new Error(`Discord rejected the alert (${response.status}).`);
}

export function candidateAlert(candidate) {
  const combo = candidate.combo;
  const route = combo.route.replace(/\s+/g, " ");
  const routePreview = route.length > 300 ? `${route.slice(0, 297)}...` : route;
  return [
    "New Labatar combo candidate ready for review",
    `${combo.characterId} / ${combo.supportId}: ${routePreview}`,
    `Candidate ID: ${candidate.id}`,
    "Open Labatar > Combos > Candidates to review it.",
  ].join("\n");
}
