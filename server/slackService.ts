// Slack notifications via official Slack Web API (independent of Replit)
import { storage } from "./storage";
import { sendNotificationEmail } from "./emailService";

// Channel where notifications are posted. Override with SLACK_CHANNEL_NAME if needed.
const SLACK_CHANNEL = (process.env.SLACK_CHANNEL_NAME || "PricingHub").replace(/^#/, "");

// Helper to make Slack Web API calls directly
async function slackApiCall(path: string, options: { method?: string; body?: any } = {}): Promise<any> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: "SLACK_BOT_TOKEN_NOT_CONFIGURED" };
  }

  const url = `https://slack.com/api${path.startsWith("/") ? path : `/${path}`}`;
  const isPost = (options.method || "GET").toUpperCase() === "POST";

  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: isPost && options.body ? JSON.stringify(options.body) : undefined,
  });

  return await res.json();
}

// Base URL used to build deep links back into the platform from a notification.
function getAppBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const devDomain = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:5000";
}

// Cache the resolved channel id, but with a TTL and the ability to invalidate
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
    const data = await slackApiCall(`/users.lookupByEmail?email=${encodeURIComponent(normalizedEmail)}`);

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
      }
      return null;
    }

    const slackUserId = typeof data.user?.id === "string" ? data.user.id : null;
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

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) return null;

  const wanted = SLACK_CHANNEL.toLowerCase();
  let cursor: string | undefined;

  try {
    do {
      const path =
        `/conversations.list?limit=200&exclude_archived=true&types=public_channel` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const data = await slackApiCall(path);

      if (!data.ok) {
        if (data.error !== "SLACK_BOT_TOKEN_NOT_CONFIGURED") {
          console.error("[Slack] conversations.list error:", data.error);
        }
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
  if (!process.env.SLACK_BOT_TOKEN?.trim()) {
    return false;
  }

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

    // Deep link back to the specific quote
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

    const data = await slackApiCall("/chat.postMessage", {
      method: "POST",
      body: {
        channel: channel.id,
        text: `${params.title} — ${slackMessage}`,
        username: "VAX Pricing Hub Bot",
        icon_emoji: ":truck:",
        blocks,
      },
    });

    if (!data.ok) {
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

// Fire-and-forget dispatch
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
  if (!process.env.SLACK_BOT_TOKEN?.trim()) {
    return { ok: false, channelFound: false, canPost: false };
  }

  try {
    const data = await slackApiCall("/auth.test");
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
