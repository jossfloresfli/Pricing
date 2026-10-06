---
name: Slack connector scopes & channel posting
description: Non-obvious limits of the Replit Slack connector when posting to a channel
---

# Replit Slack connector — posting to a channel

The Replit-managed Slack connector (proxy pattern via `@replit/connectors-sdk`) is granted a
limited scope set: `channels:read`, `channels:history`, `chat:write`, `users:read`,
`users:read.email`, `im:*`, `app_mentions:read`. It does NOT grant `groups:read` or
`channels:join`.

**Consequences (learned by debugging, not visible in code):**
- `conversations.list` with `types=public_channel,private_channel` fails with `missing_scope`
  because of the private part. List with `types=public_channel` only.
- The bot cannot auto-join a channel — `conversations.join` returns `missing_scope`.
- `chat.postMessage` to a channel the bot is not a member of returns `not_in_channel`.

**How to apply:** To post to a channel, the user must manually invite the bot
(`/invite @AppName` in the channel). `conversations.list` returns `is_member` per channel —
use it to report whether posting is actually possible. Resolve the channel id from its name,
cache it with a TTL, and invalidate the cache on `not_in_channel` / `channel_not_found` /
`is_archived` errors so a re-invite/rename recovers without a process restart.

**Non-blocking:** dispatch Slack sends fire-and-forget (don't `await` in the request path) so a
slow/hanging connector never adds latency to user-facing API responses.

**Mirrored-delivery rule:** Treat each Pricing channel event as one logical outbound event. Use a
stable, persistent idempotency key for retryable events and send Pricing email through one
central fan-out; suppress any per-user email created by the same in-app notification.

**Why:** Browser retries and users who match more than one notification role can otherwise send
duplicate Slack messages or multiple copies of the same email.

**How to apply:** Any new Slack trigger that is also mirrored to email must use the central Pricing
dispatcher. If it creates in-app notifications for a Pricing-role user, keep the in-app record but
disable that call's direct email.
