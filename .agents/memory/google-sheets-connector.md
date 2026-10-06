---
name: Google Sheets connector via SDK proxy
description: The legacy connectors v2 REST token-fetch pattern stopped working; use @replit/connectors-sdk proxy instead.
---

The old pattern of fetching `access_token` from `https://$REPLIT_CONNECTORS_HOSTNAME/api/v2/connection?connector_names=google-sheet` returns `items: []` for this repl even when the connection shows `status: added` and the user re-authorized.

**Why:** After re-authorization, the connection is only served through the new connectors SDK proxy, not the legacy secrets endpoint.

**How to apply:** Use `new ReplitConnectors().proxy('google-sheet', '/v4/spreadsheets/{id}/values/{range}')` from `@replit/connectors-sdk` (already installed). The proxy handles auth/refresh; it returns a raw Response — call `.json()`. Don't reintroduce googleapis-with-token clients for this connector.
