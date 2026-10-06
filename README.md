# Decision

Decision keeps the refund rule, date, features, and prices that were explicitly approved, then lets an assistant read that record before it answers. An assistant cannot promise a refund, a date, a feature, or a price that was never saved. A suggested change does not change the saved record until that change is accepted.

It works with ChatGPT, Claude, Gemini, Grok, and Cursor, plus any other MCP client that can do Streamable HTTP and OAuth. It is not a ChatGPT-only plugin.

Sign in with your Decision account when the assistant opens OAuth. Do not paste an API key or password into a header. Decision supports dynamic client registration: leave the client id and secret empty. The protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` points clients at the OAuth issuer, which registers them.

Decision tools need Pro or an active trial. A new subscription includes a 14-day trial. This page does not list a subscription amount. Checkout shows the billing interval and payment terms.

There is no hosted production domain in this repository. Run the server yourself and use the base URL you configure. The default MCP address is `http://127.0.0.1:3000/mcp`.

## What the assistant can do

After you approve the connection, the server exposes these tools:

- list_decision_locks
- open_decision_lock
- read_decision_lock
- save_refund_rule
- save_approved_date
- save_approved_feature
- save_approved_price
- promise_refund
- state_date
- promise_feature
- state_price
- write_client_wording
- approve_decision
- suggest_decision_change
- accept_decision_change

`read_decision_lock` is the read the assistant should do before it answers. It includes the saved refund rule, the approved date, the saved features and prices, and what the assistant may tell the client. A draft is not an approved commitment. A suggested decision change does not change the record. After the lock is approved, `promise_refund`, `state_date`, `promise_feature`, and `state_price` refuse a refund, date, feature, or price that is not in the saved record. `save_refund_rule`, `save_approved_date`, `save_approved_feature`, and `save_approved_price` also refuse a different value after approval. Those changes go through `suggest_decision_change` and then `accept_decision_change`, and only when you explicitly accept that change.

The assistant only calls these tools when you and the host allow it.

## Connect

Cursor, in `~/.cursor/mcp.json` or a project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "decision": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Do not add a headers block. Cursor registers a client and opens sign-in.

Claude Code:

```bash
claude mcp add --transport http decision http://127.0.0.1:3000/mcp
```

Do not pass an Authorization header. Other clients use the same address, choose OAuth, and leave client id and secret empty. Steps for ChatGPT, Claude, Gemini, Grok, and Cursor are on the connect page at `/connect`.

Registry metadata for this server is in `server.json` (`io.github.LAHutchins91/decision`). The remote URL there is the local listener, not a deployed host.

## Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

When stdin is a terminal, Decision serves Streamable HTTP on port 3000. When stdin is not a terminal, it speaks MCP over stdio and still opens the HTTP port. Logs during stdio mode go to stderr so they do not mix with the protocol.

Records are stored durably in a JSON file. The default path is `~/.decision/decision.json`. Set `DECISION_DATA_PATH` to move it. One server process owns that file. Do not point it at another product's data file. This build does not use a database schema. Subscription status is stored in the same JSON file.

OAuth uses the same idea as a Supabase authorization server with dynamic client registration. Set these on the server process, not in an MCP header:

- `APP_BASE_URL` (default `http://localhost:3000`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (Stripe catalog ids, not a subscription amount)

Tool calls other than discovery require a signed-in account whose subscription status is `active` or `trialing`. Discovery is `initialize` and `tools/list`.

---

More from Ouroboros: https://ouroborosapps.com
