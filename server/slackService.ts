// Slack notifications via the Replit Slack connector (Web API proxy pattern).
// Connector: ccfg_slack — posts messages to a channel using chat.postMessage.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { storage } from "./storage";
import { sendNotificationEmail } from "./emailService";

const connectors = new ReplitConnectors();

// Channel where notifications are posted. Override with SLACK_CHANNEL_NAME if needed.
const SLACK_CHANNEL = (process.env.SLACK_CHANNEL_NAME || "PricingHub").replace(/^#/, "");

// Base URL used to build deep links back into the platform from a notification.
// Prefer an explicit APP_BASE_URL (set this to the published domain after deploy);
// otherwise fall back to the current Replit dev domain. Returns null if neither is
// available so we simply skip the link instead of producing a broken URL.
function getAppBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const devDomain = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
  if (devDomain) return `https://${devDomain}`;
  return null;
}

// Cache the resolved channel id, but with a TTL and the ability to invalidate
// when Slack reports the channel is gone or the bot was removed.
const CHANNEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cachedChannel: { id: string; isMember: boolean; resolvedAt: number } | null = null;
const USER_CACHE_TTL_MS = 60 * 60 * 1000;
const cachedSlackUsers = new Map<
  string,
  { id: string | null; resolvedAt: number }
>();
let mentionScopeWarningLogged = false;

interface SlackMentionTarget {
  name: string;
  email?: string | null;
}

interface SlackNotificationParams {
  title: string;
  message: string;
  type?: string;
  requestId?: string;
  cliente?: string;
  division?: string | null;
  mentions?: SlackMentionTarget[];
}

const typeEmojis: Record<string, string> = {
  new_request: "🆕",
  status_change: "🔄",
  new_offer: "💰",
  offer_selected: "✅",
  comment: "💬",
  mention: "📣",
  info: "ℹ️",
};

function invalidateChannelCache() {
  cachedChannel = null;
}

async function resolveSlackUserIdByEmail(
  email: string,
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const cached = cachedSlackUsers.get(normalizedEmail);
  if (cached && Date.now() - cached.resolvedAt < USER_CACHE_TTL_MS) {
    return cached.id;
  }

  try {
    const path = `/users.lookupByEmail?email=${encodeURIComponent(normalizedEmail)}`;
    const res = await connectors.proxy("slack", path, { method: "GET" });
    const data = await res.json();

    if (!data.ok) {
      if (data.error === "users_not_found") {
        cachedSlackUsers.set(normalizedEmail, {
          id: null,
          resolvedAt: Date.now(),
        });
      } else if (
        data.error === "missing_scope" &&
        !mentionScopeWarningLogged
      ) {
        mentionScopeWarningLogged = true;
        console.warn(
          "[Slack] No se pueden resolver menciones: falta el permiso users:read.email",
        );
      } else {
        console.warn(
          "[Slack] users.lookupByEmail error:",
          data.error || "unknown_error",
        );
      }
      return null;
    }

    const slackUserId =
      typeof data.user?.id === "string" ? data.user.id : null;
    cachedSlackUsers.set(normalizedEmail, {
      id: slackUserId,
      resolvedAt: Date.now(),
    });
    return slackUserId;
  } catch (error) {
    console.error("[Slack] Failed to resolve mentioned user:", error);
    return null;
  }
}

export async function applyNativeSlackMentions(
  message: string,
  mentions: SlackMentionTarget[] = [],
): Promise<string> {
  const uniqueMentions = Array.from(
    new Map(
      mentions
        .filter((mention) => mention.email?.trim())
        .map((mention) => [
          mention.email!.trim().toLowerCase(),
          mention,
        ]),
    ).values(),
  );

  if (uniqueMentions.length === 0) return message;

  const resolved = await Promise.all(
    uniqueMentions.map(async (mention) => ({
      ...mention,
      slackUserId: await resolveSlackUserIdByEmail(mention.email!),
    })),
  );

  let slackMessage = message;
  for (const mention of resolved) {
    if (!mention.slackUserId) continue;
    const escapedName = mention.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionPattern = new RegExp(
      `@${escapedName}(?=[\\s,;.!?:\"'\\)\\]\\}]|$)`,
      "gi",
    );
    slackMessage = slackMessage.replace(
      mentionPattern,
      `<@${mention.slackUserId}>`,
    );
  }

  return slackMessage;
}

async function resolveChannel(
  forceRefresh = false
): Promise<{ id: string; isMember: boolean } | null> {
  if (
    !forceRefresh &&
    cachedChannel &&
    Date.now() - cachedChannel.resolvedAt < CHANNEL_CACHE_TTL_MS
  ) {
    return { id: cachedChannel.id, isMember: cachedChannel.isMember };
  }

  const wanted = SLACK_CHANNEL.toLowerCase();
  let cursor: string | undefined;

  try {
    do {
      // Only public_channel — private_channel requires groups:read which the connector does not grant.
      const path =
        `/conversations.list?limit=200&exclude_archived=true&types=public_channel` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const res = await connectors.proxy("slack", path, { method: "GET" });
      const data = await res.json();

      if (!data.ok) {
        console.error("[Slack] conversations.list error:", data.error);
        return null;
      }

      const found = data.channels?.find(
        (c: any) => c.name?.toLowerCase() === wanted
      );
      if (found) {
        cachedChannel = {
          id: found.id,
          isMember: !!found.is_member,
          resolvedAt: Date.now(),
        };
        return { id: found.id, isMember: !!found.is_member };
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (error) {
    console.error("[Slack] Failed to resolve channel:", error);
    return null;
  }

  console.warn(
    `[Slack] No se encontró el canal #${SLACK_CHANNEL}. Asegúrate de que el bot esté invitado al canal (escribe /invite @TuApp en #${SLACK_CHANNEL}).`
  );
  return null;
}

export async function sendSlackNotification(
  params: SlackNotificationParams
): Promise<boolean> {
  try {
    const channel = await resolveChannel();
    if (!channel) return false;

    const emoji = typeEmojis[params.type || "info"] || typeEmojis.info;
    const slackMessage = await applyNativeSlackMentions(
      params.message,
      params.mentions,
    );

    const contextLines: string[] = [];
    if (params.cliente) contextLines.push(`*Cliente:* ${params.cliente}`);
    if (params.division) contextLines.push(`*División:* ${params.division}`);
    if (params.requestId) contextLines.push(`*ID:* #${params.requestId}`);

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${params.title}*\n${slackMessage}`,
        },
      },
    ];

    if (contextLines.length > 0) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: contextLines.join("   •   ") }],
      });
    }

    // Deep link back to the specific quote, when we have an id and a base URL.
    const baseUrl = getAppBaseUrl();
    if (params.requestId && baseUrl) {
      const quoteUrl = `${baseUrl}/board?detail=${encodeURIComponent(params.requestId)}`;
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Ver cotización", emoji: true },
            url: quoteUrl,
            style: "primary",
          },
        ],
      });
    }

    const res = await connectors.proxy("slack", "/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: channel.id,
        text: `${params.title} — ${slackMessage}`,
        username: "VAX Pricing Hub Bot",
        icon_emoji: ":truck:",
        blocks,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      // Stale-channel errors: drop the cache so the next call re-resolves.
      if (
        data.error === "channel_not_found" ||
        data.error === "not_in_channel" ||
        data.error === "is_archived"
      ) {
        invalidateChannelCache();
      }
      console.error("[Slack] chat.postMessage error:", data.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Slack] Failed to send notification:", error);
    return false;
  }
}

// Fire-and-forget dispatch: never blocks or throws into the caller's request flow.
export function dispatchSlackNotification(params: SlackNotificationParams): void {
  sendSlackNotification(params).catch((error) => {
    console.error("[Slack] dispatch failed:", error);
  });
}

async function sendPricingTeamEmails(
  params: SlackNotificationParams,
): Promise<void> {
  try {
    const users = await storage.getUsers();
    const recipients = Array.from(
      new Map(
        users
          .filter(
            (user) =>
              user.active &&
              user.role === "pricing" &&
              typeof user.email === "string" &&
              user.email.trim().length > 0,
          )
          .map((user) => [
            user.email!.trim().toLowerCase(),
            {
              email: user.email!.trim(),
              name: user.name || user.username || "Usuario",
            },
          ]),
      ).values(),
    );

    if (recipients.length === 0) {
      console.warn(
        "[Email] No hay usuarios activos de Pricing con correo configurado",
      );
      return;
    }

    const results = await Promise.all(
      recipients.map((recipient) =>
        sendNotificationEmail({
          to: recipient.email,
          userName: recipient.name,
          title: params.title,
          message: params.message,
          type: params.type || "info",
          requestId: params.requestId,
        }),
      ),
    );
    const failedCount = results.filter((sent) => !sent).length;
    if (failedCount > 0) {
      console.error(
        `[Email] Fallaron ${failedCount} de ${recipients.length} correos para Pricing`,
      );
    }
  } catch (error) {
    console.error("[Email] Failed to notify Pricing team:", error);
  }
}

// Every event sent to the Pricing Slack channel is mirrored once by email to
// each active Pricing user. Both deliveries are independent and non-blocking.
export function dispatchPricingTeamNotification(
  params: SlackNotificationParams,
): void {
  void Promise.allSettled([
    sendSlackNotification(params),
    sendPricingTeamEmails(params),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[Pricing notification] dispatch failed:", result.reason);
      }
    }
  });
}

export async function testSlackConnection(): Promise<{
  ok: boolean;
  channelFound: boolean;
  canPost: boolean;
}> {
  try {
    const res = await connectors.proxy("slack", "/auth.test", { method: "GET" });
    const data = await res.json();
    const channel = await resolveChannel(true);
    return {
      ok: !!data.ok,
      channelFound: !!channel,
      canPost: !!channel?.isMember,
    };
  } catch (error) {
    console.error("[Slack] Connection test failed:", error);
    return { ok: false, channelFound: false, canPost: false };
  }
}
