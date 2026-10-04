import { readFile, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFUSED_DATE,
  REFUSED_DRAFT_REFUND,
  REFUSED_FEATURE,
  REFUSED_NEW_FEATURE,
  REFUSED_PRICE,
  REFUSED_REFUND,
  REFUSED_REFUND_WRITE
} from "../src/decision-policy.js";
import { assertDecisionDataPath, createFileDecisionStore, defaultDecisionDataPath } from "../src/decision-store.js";

const WORDING = "State only the saved refund rule, the saved date, the saved feature, and the saved price.";
const REFUND = "Replacement within the return window. No cash return.";
const DATE = "2026-06-01";
const FEATURE = "CSV export";
const PRICE = "Starter";

async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "decision-"));
  return createFileDecisionStore(path.join(dir, "decision.json"));
}

async function approved() {
  const saved = await store();
  const lock = await saved.openDecisionLock("user-1", {
    partyName: "Northwind",
    subject: "Spring plan",
    reference: "DC-104"
  });
  await saved.saveRefundRule("user-1", { decisionId: lock.id, refundRule: REFUND });
  await saved.saveApprovedDate("user-1", { decisionId: lock.id, approvedDate: DATE });
  await saved.saveApprovedFeature("user-1", {
    decisionId: lock.id,
    title: FEATURE,
    detail: "A downloadable table of the account's own rows."
  });
  await saved.saveApprovedPrice("user-1", {
    decisionId: lock.id,
    label: PRICE,
    terms: "The amount written on the approved order."
  });
  await saved.writeClientWording("user-1", { decisionId: lock.id, wording: WORDING });
  await saved.approveDecision("user-1", lock.id);
  return { saved, decisionId: lock.id };
}

describe("decision store", () => {
  it("uses its own data file and refuses other product files", () => {
    expect(defaultDecisionDataPath()).toBe(path.join(os.homedir(), ".decision", "decision.json"));
    expect(assertDecisionDataPath(defaultDecisionDataPath())).toBe(path.resolve(defaultDecisionDataPath()));
    for (const [dir, file] of [
      [".scope", "scope.json"],
      [".retain", "retain.json"],
      [".invoice", "invoice.json"],
      [".deposit", "deposit.json"],
      [".milestone", "milestone.json"]
    ] as const) {
      expect(() => assertDecisionDataPath(path.join(os.homedir(), dir, file))).toThrow(/own file/);
      expect(() => assertDecisionDataPath(`~/${dir}/${file}`)).toThrow(/own file/);
      expect(() => assertDecisionDataPath(path.join(os.homedir(), dir, "notes.txt"))).toThrow(/own file/);
      expect(() => assertDecisionDataPath(path.join("/tmp", file))).toThrow(/own file/);
    }
    expect(() => createFileDecisionStore(path.join(os.homedir(), ".milestone", "milestone.json"))).toThrow(/own file/);
  });

  it("does not read or write another product file through a symlink", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decision-link-"));
    const foreign = path.join(dir, "milestone.json");
    const original = "{\"secret\":true}";
    await writeFile(foreign, original, "utf8");
    const link = path.join(dir, "decision.json");
    await symlink(foreign, link);
    const saved = createFileDecisionStore(link);
    await expect(saved.getProfile("user-1")).rejects.toThrow(/own file/);
    expect(await readFile(foreign, "utf8")).toBe(original);
  });

  it("refuses an unsaved refund, date, feature, or price, and applies a change only when it is accepted", async () => {
    const { saved, decisionId } = await approved();

    await expect(saved.promiseRefund("user-1", {
      decisionId,
      refund: "A full cash return whenever the client asks."
    })).rejects.toThrow(REFUSED_REFUND);
    await expect(saved.stateDate("user-1", { decisionId, date: "2026-12-01" })).rejects.toThrow(REFUSED_DATE);
    await expect(saved.promiseFeature("user-1", { decisionId, title: "Single sign-on" })).rejects.toThrow(REFUSED_FEATURE);
    await expect(saved.statePrice("user-1", { decisionId, label: "Enterprise" })).rejects.toThrow(REFUSED_PRICE);

    expect((await saved.promiseRefund("user-1", { decisionId, refund: REFUND })).refundRule).toBe(REFUND);
    expect((await saved.stateDate("user-1", { decisionId, date: DATE })).approvedDate).toBe(DATE);
    expect((await saved.promiseFeature("user-1", { decisionId, title: FEATURE })).title).toBe(FEATURE);
    expect((await saved.statePrice("user-1", { decisionId, label: PRICE })).label).toBe(PRICE);

    await expect(saved.saveRefundRule("user-1", {
      decisionId,
      refundRule: "A full cash return whenever the client asks."
    })).rejects.toThrow(REFUSED_REFUND_WRITE);
    await expect(saved.saveApprovedFeature("user-1", {
      decisionId,
      title: "Single sign-on",
      detail: "An identity provider that was never approved."
    })).rejects.toThrow(REFUSED_NEW_FEATURE);

    const before = await saved.readDecisionLock("user-1", decisionId);
    expect(before.decision.status).toBe("approved");
    expect(before.refundRule).toBe(REFUND);
    expect(before.features).toHaveLength(1);
    expect(before.mayTellClient.limits.join(" ")).toContain(REFUND);
    expect(before.guidance).toContain("approved");

    const suggested = await saved.suggestDecisionChange("user-1", {
      decisionId,
      kind: "add_feature",
      summary: "The user asked to consider one more feature.",
      featureTitle: "Single sign-on",
      featureDetail: "Sign-in with the company identity provider."
    });
    expect(suggested.status).toBe("proposed");
    expect(suggested.applied).toBe(false);
    const pending = await saved.readDecisionLock("user-1", decisionId);
    expect(pending.features.map((row) => row.title)).toEqual([FEATURE]);
    expect(pending.refundRule).toBe(REFUND);
    expect(pending.proposedChanges).toHaveLength(1);

    const applied = await saved.acceptDecisionChange("user-1", decisionId, suggested.id);
    expect(applied.features.map((row) => row.title)).toContain("Single sign-on");
    expect(applied.refundRule).toBe(REFUND);
    const appliedAgain = await saved.acceptDecisionChange("user-1", decisionId, suggested.id);
    expect(appliedAgain.features.filter((row) => row.title === "Single sign-on")).toHaveLength(1);

    const refundChange = await saved.suggestDecisionChange("user-1", {
      decisionId,
      kind: "revise_refund_rule",
      summary: "The user asked to revise the refund rule.",
      refundRule: "Store credit within the return window."
    });
    expect((await saved.readDecisionLock("user-1", decisionId)).refundRule).toBe(REFUND);
    const revised = await saved.acceptDecisionChange("user-1", decisionId, refundChange.id);
    expect(revised.refundRule).toBe("Store credit within the return window.");
    await expect(saved.promiseRefund("user-1", { decisionId, refund: REFUND })).rejects.toThrow(REFUSED_REFUND);
    expect((await saved.promiseRefund("user-1", {
      decisionId,
      refund: "Store credit within the return window."
    })).refundRule).toBe("Store credit within the return window.");
  });

  it("refuses a refund promise before the decision is approved", async () => {
    const saved = await store();
    const lock = await saved.openDecisionLock("user-1", {
      partyName: "Ada",
      subject: "Writing desk",
      reference: "DC-9"
    });
    await saved.saveRefundRule("user-1", { decisionId: lock.id, refundRule: REFUND });
    await expect(saved.promiseRefund("user-1", { decisionId: lock.id, refund: REFUND })).rejects.toThrow(REFUSED_DRAFT_REFUND);
  });

  it("keeps each account's decisions and reloads them from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "decision-"));
    const file = path.join(dir, "decision.json");
    const first = createFileDecisionStore(file);
    const lock = await first.openDecisionLock("user-1", {
      partyName: "Ada",
      subject: "Writing desk",
      reference: "DC-9"
    });
    await expect(first.readDecisionLock("user-2", lock.id)).rejects.toThrow("Decision lock not found");
    const second = createFileDecisionStore(file);
    const listed = await second.listDecisionLocks("user-1", 0);
    expect(listed.decisions[0]?.id).toBe(lock.id);
    expect(listed.decisions[0]?.subject).toBe("Writing desk");
    expect(await second.listDecisionLocks("user-2", 0)).toEqual({ decisions: [], nextOffset: null });
  });
});
