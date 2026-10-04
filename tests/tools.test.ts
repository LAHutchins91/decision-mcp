import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import { createFileDecisionStore, type DecisionStore } from "../src/decision-store.js";
import { DECISION_TOOL_NAMES, createDecisionMcpServer } from "../src/decision-tools.js";

async function connect(options: { userId: string; entitled: boolean; store: DecisionStore }) {
  const client = new Client({ name: "decision-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createDecisionMcpServer(options);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("decision tools", () => {
  it("lists the Decision tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decision-"));
    const client = await connect({ userId: "", entitled: false, store: createFileDecisionStore(path.join(dir, "decision.json")) });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...DECISION_TOOL_NAMES].sort());
    const blob = listed.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\$\d/);
    expect(blob.toLowerCase()).not.toContain("dollar");
  });

  it("refuses tool calls without sign-in or an active trial", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decision-"));
    const saved = createFileDecisionStore(path.join(dir, "decision.json"));
    const anonymous = await connect({ userId: "", entitled: false, store: saved });
    const signedOut = await anonymous.callTool({ name: "list_decision_locks", arguments: {} });
    expect(signedOut.isError).toBe(true);
    expect(textOf(signedOut)).toContain(SIGN_IN_REQUIRED);

    const unpaid = await connect({ userId: "user-1", entitled: false, store: saved });
    const blocked = await unpaid.callTool({ name: "list_decision_locks", arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain(PRO_REQUIRED);
  });

  it("refuses an unsaved refund, date, feature, or price until a suggested change is accepted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decision-"));
    const saved = createFileDecisionStore(path.join(dir, "decision.json"));
    const client = await connect({ userId: "user-1", entitled: true, store: saved });
    const created = await client.callTool({
      name: "open_decision_lock",
      arguments: { partyName: "Northwind", subject: "Spring plan", reference: "DC-104" }
    });
    const decisionId = JSON.parse(textOf(created)).decision.id as string;
    await client.callTool({
      name: "save_refund_rule",
      arguments: { decisionId, refundRule: "Replacement within the return window." }
    });
    await client.callTool({
      name: "save_approved_date",
      arguments: { decisionId, approvedDate: "2026-06-01" }
    });
    await client.callTool({
      name: "save_approved_feature",
      arguments: { decisionId, title: "CSV export", detail: "A downloadable table of the account's own rows." }
    });
    await client.callTool({
      name: "save_approved_price",
      arguments: { decisionId, label: "Starter", terms: "The amount written on the approved order." }
    });
    await client.callTool({
      name: "write_client_wording",
      arguments: { decisionId, wording: "State only the saved refund, date, feature, and price." }
    });
    await client.callTool({ name: "approve_decision", arguments: { decisionId, confirmed: true } });

    const refund = await client.callTool({
      name: "promise_refund",
      arguments: { decisionId, refund: "A full cash return whenever the client asks." }
    });
    expect(refund.isError).toBe(true);
    expect(textOf(refund)).toContain("Refused:");
    expect(textOf(refund)).toContain("refund");

    const date = await client.callTool({
      name: "state_date",
      arguments: { decisionId, date: "2026-12-01" }
    });
    expect(date.isError).toBe(true);
    expect(textOf(date)).toContain("date");

    const feature = await client.callTool({
      name: "promise_feature",
      arguments: { decisionId, title: "Single sign-on" }
    });
    expect(feature.isError).toBe(true);
    expect(textOf(feature)).toContain("feature");

    const price = await client.callTool({
      name: "state_price",
      arguments: { decisionId, label: "Enterprise" }
    });
    expect(price.isError).toBe(true);
    expect(textOf(price)).toContain("price");

    const suggestion = await client.callTool({
      name: "suggest_decision_change",
      arguments: {
        decisionId,
        kind: "add_feature",
        summary: "The user asked to consider one more feature.",
        featureTitle: "Single sign-on",
        featureDetail: "Sign-in with the company identity provider."
      }
    });
    const changeId = JSON.parse(textOf(suggestion)).id as string;
    const pending = await client.callTool({ name: "read_decision_lock", arguments: { decisionId } });
    expect(JSON.parse(textOf(pending)).features).toHaveLength(1);
    expect(JSON.parse(textOf(pending)).refundRule).toContain("Replacement");
    expect(textOf(pending)).toContain("Do not promise a feature that is not saved");

    const applied = await client.callTool({
      name: "accept_decision_change",
      arguments: { decisionId, changeId, confirmed: true }
    });
    expect(JSON.parse(textOf(applied)).features).toHaveLength(2);
    const allowed = await client.callTool({
      name: "promise_feature",
      arguments: { decisionId, title: "Single sign-on" }
    });
    expect(allowed.isError).toBeUndefined();
    expect(JSON.parse(textOf(allowed)).title).toBe("Single sign-on");
  });
});
