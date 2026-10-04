import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RECORD_GUIDANCE,
  REFUSED_FEATURE,
  REFUSED_PRICE,
  DecisionRefusal,
  DecisionUserError,
  assertDatePromise,
  assertDateWrite,
  assertFeaturePromise,
  assertNewFeature,
  assertNewPrice,
  assertPricePromise,
  assertRefundPromise,
  assertRefundWrite,
  assertWordingWrite,
  buildMayTellClient,
  labelKey,
  type ChangeKind,
  type LockStatus,
  type MayTellClient
} from "./decision-policy.js";

export type { ChangeKind, LockStatus, MayTellClient };

const MAX_LOCKS = 50;
const PAGE_SIZE = 20;
const MAX_FEATURES = 40;
const MAX_PRICES = 20;
const MAX_CHANGES = 200;
const MAX_SUPPORT = 200;

const FOREIGN_HOME_DIRS = [".scope", ".retain", ".invoice", ".deposit", ".milestone"] as const;
const FOREIGN_FILE_NAMES = new Set(["scope.json", "retain.json", "invoice.json", "deposit.json", "milestone.json"]);

export type ApprovedFeature = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
};

export type ApprovedPrice = {
  id: string;
  label: string;
  terms: string;
  createdAt: string;
};

export type DecisionChange = {
  id: string;
  kind: ChangeKind;
  status: "proposed" | "approved";
  summary: string;
  refundRule: string | null;
  approvedDate: string | null;
  featureId: string | null;
  featureTitle: string | null;
  featureDetail: string | null;
  priceId: string | null;
  priceLabel: string | null;
  priceTerms: string | null;
  wording: string | null;
  applied: boolean;
  createdAt: string;
  approvedAt: string | null;
};

export type DecisionLock = {
  id: string;
  partyName: string;
  subject: string;
  reference: string;
  status: LockStatus;
  approvedAt: string | null;
  refundRule: string | null;
  approvedDate: string | null;
  features: ApprovedFeature[];
  prices: ApprovedPrice[];
  clientWording: string | null;
  changes: DecisionChange[];
  createdAt: string;
  updatedAt: string;
};

export type DecisionSummary = {
  id: string;
  partyName: string;
  subject: string;
  reference: string;
  status: LockStatus;
  featureCount: number;
  priceCount: number;
};

export type Profile = {
  userId: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type DecisionRecord = {
  decision: {
    id: string;
    partyName: string;
    subject: string;
    reference: string;
    status: LockStatus;
    approvedAt: string | null;
  };
  refundRule: string | null;
  approvedDate: string | null;
  features: ApprovedFeature[];
  prices: ApprovedPrice[];
  clientWording: string | null;
  mayTellClient: MayTellClient;
  approvedChanges: DecisionChange[];
  proposedChanges: DecisionChange[];
  guidance: string;
};

export type OpenDecisionInput = {
  partyName: string;
  subject: string;
  reference: string;
};

export type RefundInput = {
  decisionId: string;
  refundRule: string;
};

export type DateInput = {
  decisionId: string;
  approvedDate: string;
};

export type FeatureInput = {
  decisionId: string;
  title: string;
  detail: string;
};

export type PriceInput = {
  decisionId: string;
  label: string;
  terms: string;
};

export type PromiseRefundInput = {
  decisionId: string;
  refund: string;
};

export type StateDateInput = {
  decisionId: string;
  date: string;
};

export type PromiseFeatureInput = {
  decisionId: string;
  title: string;
};

export type StatePriceInput = {
  decisionId: string;
  label: string;
};

export type ClientWordingInput = {
  decisionId: string;
  wording: string;
};

export type SuggestChangeInput = {
  decisionId: string;
  kind: ChangeKind;
  summary: string;
  refundRule?: string;
  approvedDate?: string;
  featureId?: string;
  featureTitle?: string;
  featureDetail?: string;
  priceId?: string;
  priceLabel?: string;
  priceTerms?: string;
  wording?: string;
};

type SupportRequest = { id: string; email: string; message: string; createdAt: string };

type FileData = {
  version: 1;
  profiles: Record<string, Profile>;
  decisions: Record<string, DecisionLock[]>;
  supportRequests: SupportRequest[];
};

export type DecisionStore = {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Omit<Profile, "userId">>): Promise<Profile>;
  listDecisionLocks(userId: string, offset: number): Promise<{ decisions: DecisionSummary[]; nextOffset: number | null }>;
  openDecisionLock(userId: string, input: OpenDecisionInput): Promise<DecisionLock>;
  readDecisionLock(userId: string, decisionId: string): Promise<DecisionRecord>;
  saveRefundRule(userId: string, input: RefundInput): Promise<{ refundRule: string }>;
  saveApprovedDate(userId: string, input: DateInput): Promise<{ approvedDate: string }>;
  saveApprovedFeature(userId: string, input: FeatureInput): Promise<ApprovedFeature>;
  saveApprovedPrice(userId: string, input: PriceInput): Promise<ApprovedPrice>;
  promiseRefund(userId: string, input: PromiseRefundInput): Promise<{ refundRule: string }>;
  stateDate(userId: string, input: StateDateInput): Promise<{ approvedDate: string }>;
  promiseFeature(userId: string, input: PromiseFeatureInput): Promise<ApprovedFeature>;
  statePrice(userId: string, input: StatePriceInput): Promise<ApprovedPrice>;
  writeClientWording(userId: string, input: ClientWordingInput): Promise<{ clientWording: string }>;
  approveDecision(userId: string, decisionId: string): Promise<DecisionRecord>;
  suggestDecisionChange(userId: string, input: SuggestChangeInput): Promise<DecisionChange>;
  acceptDecisionChange(userId: string, decisionId: string, changeId: string): Promise<DecisionRecord>;
  addSupportRequest(input: { email: string; message: string }): Promise<{ id: string }>;
};

export function defaultDecisionDataPath(): string {
  return path.join(os.homedir(), ".decision", "decision.json");
}

export function assertDecisionDataPath(filePath: string): string {
  const trimmed = filePath.trim();
  const expanded = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  const resolved = path.resolve(expanded);
  if (FOREIGN_FILE_NAMES.has(path.basename(resolved).toLowerCase())) {
    throw new DecisionUserError("Decision data must use its own file.");
  }
  for (const dir of FOREIGN_HOME_DIRS) {
    const root = path.resolve(path.join(os.homedir(), dir));
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
      throw new DecisionUserError("Decision data must use its own file.");
    }
  }
  return resolved;
}

function emptyData(): FileData {
  return { version: 1, profiles: {}, decisions: {}, supportRequests: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) throw new DecisionUserError(`${label} must be 1–${max} characters.`);
  return text;
}

function blankProfile(userId: string): Profile {
  return {
    userId,
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false
  };
}

function summary(lock: DecisionLock): DecisionSummary {
  return {
    id: lock.id,
    partyName: lock.partyName,
    subject: lock.subject,
    reference: lock.reference,
    status: lock.status,
    featureCount: lock.features.length,
    priceCount: lock.prices.length
  };
}

function toRecord(lock: DecisionLock): DecisionRecord {
  return {
    decision: {
      id: lock.id,
      partyName: lock.partyName,
      subject: lock.subject,
      reference: lock.reference,
      status: lock.status,
      approvedAt: lock.approvedAt
    },
    refundRule: lock.refundRule,
    approvedDate: lock.approvedDate,
    features: lock.features,
    prices: lock.prices,
    clientWording: lock.clientWording,
    mayTellClient: buildMayTellClient({
      status: lock.status,
      clientWording: lock.clientWording,
      refundRule: lock.refundRule,
      approvedDate: lock.approvedDate,
      features: lock.features,
      prices: lock.prices
    }),
    approvedChanges: lock.changes.filter((change) => change.status === "approved"),
    proposedChanges: lock.changes.filter((change) => change.status === "proposed"),
    guidance: RECORD_GUIDANCE
  };
}

function locksFor(data: FileData, userId: string): DecisionLock[] {
  const rows = data.decisions[userId];
  if (!rows) {
    data.decisions[userId] = [];
    return data.decisions[userId];
  }
  return rows;
}

function findLock(data: FileData, userId: string, decisionId: string): DecisionLock {
  const lock = (data.decisions[userId] ?? []).find((row) => row.id === decisionId);
  if (!lock) throw new DecisionUserError("Decision lock not found");
  return lock;
}

function findFeature(lock: DecisionLock, featureId: string): ApprovedFeature {
  const feature = lock.features.find((row) => row.id === featureId);
  if (!feature) throw new DecisionUserError("Feature not found");
  return feature;
}

function findPrice(lock: DecisionLock, priceId: string): ApprovedPrice {
  const price = lock.prices.find((row) => row.id === priceId);
  if (!price) throw new DecisionUserError("Price not found");
  return price;
}

function blankChange(kind: ChangeKind, summaryText: string): DecisionChange {
  const stamp = nowIso();
  return {
    id: randomUUID(),
    kind,
    status: "proposed",
    summary: summaryText,
    refundRule: null,
    approvedDate: null,
    featureId: null,
    featureTitle: null,
    featureDetail: null,
    priceId: null,
    priceLabel: null,
    priceTerms: null,
    wording: null,
    applied: false,
    createdAt: stamp,
    approvedAt: null
  };
}

async function assertReachablePath(filePath: string): Promise<void> {
  assertDecisionDataPath(filePath);
  let current = filePath;
  for (;;) {
    try {
      const real = await realpath(current);
      if (current === filePath) assertDecisionDataPath(real);
      else assertDecisionDataPath(path.resolve(real, path.relative(current, filePath)));
      return;
    } catch (error) {
      if (error instanceof DecisionUserError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new DecisionUserError("Decision data could not be read.");
      }
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

export function createFileDecisionStore(filePath: string): DecisionStore {
  const resolved = assertDecisionDataPath(filePath);
  let chain: Promise<void> = Promise.resolve();

  async function read(): Promise<FileData> {
    await assertReachablePath(resolved);
    try {
      const text = await readFile(resolved, "utf8");
      if (!text.trim()) return emptyData();
      const parsed = JSON.parse(text) as FileData;
      if (parsed.version !== 1 || !parsed.profiles || !parsed.decisions || !Array.isArray(parsed.supportRequests)) {
        throw new DecisionUserError("Decision data could not be read.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      if (error instanceof DecisionUserError) throw error;
      throw new DecisionUserError("Decision data could not be read.");
    }
  }

  async function write(data: FileData): Promise<void> {
    await assertReachablePath(resolved);
    await mkdir(path.dirname(resolved), { recursive: true });
    const tmp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, resolved);
  }

  function enqueue<T>(fn: (data: FileData) => T, persist: boolean): Promise<T> {
    const run = chain.then(async () => {
      const data = await read();
      const result = fn(data);
      if (persist) await write(data);
      return structuredClone(result);
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    getProfile(userId) {
      return enqueue((data) => data.profiles[userId] ?? blankProfile(userId), false);
    },
    updateProfile(userId, patch) {
      return enqueue((data) => {
        const current = data.profiles[userId] ?? blankProfile(userId);
        const next: Profile = { ...current, ...patch, userId };
        data.profiles[userId] = next;
        return next;
      }, true);
    },
    listDecisionLocks(userId, offset) {
      return enqueue((data) => {
        const rows = data.decisions[userId] ?? [];
        const start = Math.max(0, offset);
        const page = rows.slice(start, start + PAGE_SIZE).map(summary);
        const nextOffset = start + page.length < rows.length ? start + page.length : null;
        return { decisions: page, nextOffset };
      }, false);
    },
    openDecisionLock(userId, input) {
      return enqueue((data) => {
        const rows = locksFor(data, userId);
        if (rows.length >= MAX_LOCKS) throw new DecisionUserError("Decision lock limit reached.");
        const reference = cleanText(input.reference, "Reference", 40);
        if (rows.some((row) => labelKey(row.reference) === labelKey(reference))) {
          throw new DecisionUserError("That reference is already in use.");
        }
        const stamp = nowIso();
        const lock: DecisionLock = {
          id: randomUUID(),
          partyName: cleanText(input.partyName, "Party name", 200),
          subject: cleanText(input.subject, "Subject", 200),
          reference,
          status: "draft",
          approvedAt: null,
          refundRule: null,
          approvedDate: null,
          features: [],
          prices: [],
          clientWording: null,
          changes: [],
          createdAt: stamp,
          updatedAt: stamp
        };
        rows.unshift(lock);
        return lock;
      }, true);
    },
    readDecisionLock(userId, decisionId) {
      return enqueue((data) => toRecord(findLock(data, userId, decisionId)), false);
    },
    saveRefundRule(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const refundRule = cleanText(input.refundRule, "Refund rule", 2000);
        assertRefundWrite(lock.status, lock.refundRule, refundRule);
        const stamp = nowIso();
        lock.refundRule = refundRule;
        lock.updatedAt = stamp;
        return { refundRule };
      }, true);
    },
    saveApprovedDate(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const approvedDate = cleanText(input.approvedDate, "Approved date", 200);
        assertDateWrite(lock.status, lock.approvedDate, approvedDate);
        const stamp = nowIso();
        lock.approvedDate = approvedDate;
        lock.updatedAt = stamp;
        return { approvedDate };
      }, true);
    },
    saveApprovedFeature(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const title = cleanText(input.title, "Feature title", 200);
        if (lock.features.some((row) => labelKey(row.title) === labelKey(title))) {
          throw new DecisionUserError("That feature is already saved.");
        }
        assertNewFeature(lock.status);
        if (lock.features.length >= MAX_FEATURES) throw new DecisionUserError("Feature limit reached.");
        const stamp = nowIso();
        const feature: ApprovedFeature = {
          id: randomUUID(),
          title,
          detail: cleanText(input.detail, "Feature detail", 1000),
          createdAt: stamp
        };
        lock.features.push(feature);
        lock.updatedAt = stamp;
        return feature;
      }, true);
    },
    saveApprovedPrice(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const label = cleanText(input.label, "Price label", 200);
        if (lock.prices.some((row) => labelKey(row.label) === labelKey(label))) {
          throw new DecisionUserError("That price is already saved.");
        }
        assertNewPrice(lock.status);
        if (lock.prices.length >= MAX_PRICES) throw new DecisionUserError("Price limit reached.");
        const stamp = nowIso();
        const price: ApprovedPrice = {
          id: randomUUID(),
          label,
          terms: cleanText(input.terms, "Price terms", 1000),
          createdAt: stamp
        };
        lock.prices.push(price);
        lock.updatedAt = stamp;
        return price;
      }, true);
    },
    promiseRefund(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const stated = cleanText(input.refund, "Refund", 2000);
        assertRefundPromise({ status: lock.status, saved: lock.refundRule, stated });
        return { refundRule: lock.refundRule ?? stated };
      }, false);
    },
    stateDate(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const stated = cleanText(input.date, "Date", 200);
        assertDatePromise({ status: lock.status, saved: lock.approvedDate, stated });
        return { approvedDate: lock.approvedDate ?? stated };
      }, false);
    },
    promiseFeature(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const title = cleanText(input.title, "Feature title", 200);
        const feature = lock.features.find((row) => labelKey(row.title) === labelKey(title));
        assertFeaturePromise(lock.status, Boolean(feature));
        if (!feature) throw new DecisionRefusal(REFUSED_FEATURE);
        return feature;
      }, false);
    },
    statePrice(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const label = cleanText(input.label, "Price label", 200);
        const price = lock.prices.find((row) => labelKey(row.label) === labelKey(label));
        assertPricePromise(lock.status, Boolean(price));
        if (!price) throw new DecisionRefusal(REFUSED_PRICE);
        return price;
      }, false);
    },
    writeClientWording(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        const wording = cleanText(input.wording, "Client wording", 2000);
        assertWordingWrite(lock.status, lock.clientWording, wording);
        const stamp = nowIso();
        lock.clientWording = wording;
        lock.updatedAt = stamp;
        return { clientWording: wording };
      }, true);
    },
    approveDecision(userId, decisionId) {
      return enqueue((data) => {
        const lock = findLock(data, userId, decisionId);
        if (lock.status === "approved") return toRecord(lock);
        if (!lock.refundRule) throw new DecisionUserError("A refund rule is required before the decision can be approved.");
        if (!lock.approvedDate) throw new DecisionUserError("An approved date is required before the decision can be approved.");
        if (lock.features.length === 0) throw new DecisionUserError("An approved feature is required before the decision can be approved.");
        if (lock.prices.length === 0) throw new DecisionUserError("An approved price is required before the decision can be approved.");
        if (!lock.clientWording) throw new DecisionUserError("Client wording is required before the decision can be approved.");
        const stamp = nowIso();
        lock.status = "approved";
        lock.approvedAt = stamp;
        lock.updatedAt = stamp;
        return toRecord(lock);
      }, true);
    },
    suggestDecisionChange(userId, input) {
      return enqueue((data) => {
        const lock = findLock(data, userId, input.decisionId);
        if (lock.status !== "approved") throw new DecisionUserError("Approve the decision before suggesting a change.");
        if (lock.changes.length >= MAX_CHANGES) throw new DecisionUserError("Decision change limit reached.");
        const summaryText = cleanText(input.summary, "Summary", 1000);
        const change = blankChange(input.kind, summaryText);
        if (input.kind === "revise_refund_rule") {
          const refundRule = cleanText(input.refundRule ?? "", "Refund rule", 2000);
          if (refundRule === lock.refundRule) throw new DecisionUserError("That change does not change the saved refund rule.");
          change.refundRule = refundRule;
        } else if (input.kind === "revise_approved_date") {
          const approvedDate = cleanText(input.approvedDate ?? "", "Approved date", 200);
          if (approvedDate === lock.approvedDate) throw new DecisionUserError("That change does not change the saved date.");
          change.approvedDate = approvedDate;
        } else if (input.kind === "add_feature") {
          if (lock.features.length >= MAX_FEATURES) throw new DecisionUserError("Feature limit reached.");
          const title = cleanText(input.featureTitle ?? "", "Feature title", 200);
          if (lock.features.some((row) => labelKey(row.title) === labelKey(title))) {
            throw new DecisionUserError("That feature is already saved.");
          }
          change.featureTitle = title;
          change.featureDetail = cleanText(input.featureDetail ?? "", "Feature detail", 1000);
        } else if (input.kind === "revise_feature") {
          if (!input.featureId) throw new DecisionUserError("A feature id is required.");
          const feature = findFeature(lock, input.featureId);
          const title = cleanText(input.featureTitle ?? "", "Feature title", 200);
          const detail = cleanText(input.featureDetail ?? "", "Feature detail", 1000);
          if (title === feature.title && detail === feature.detail) {
            throw new DecisionUserError("That change does not change the saved feature.");
          }
          if (lock.features.some((row) => row.id !== feature.id && labelKey(row.title) === labelKey(title))) {
            throw new DecisionUserError("That feature is already saved.");
          }
          change.featureId = feature.id;
          change.featureTitle = title;
          change.featureDetail = detail;
        } else if (input.kind === "add_price") {
          if (lock.prices.length >= MAX_PRICES) throw new DecisionUserError("Price limit reached.");
          const label = cleanText(input.priceLabel ?? "", "Price label", 200);
          if (lock.prices.some((row) => labelKey(row.label) === labelKey(label))) {
            throw new DecisionUserError("That price is already saved.");
          }
          change.priceLabel = label;
          change.priceTerms = cleanText(input.priceTerms ?? "", "Price terms", 1000);
        } else if (input.kind === "revise_price") {
          if (!input.priceId) throw new DecisionUserError("A price id is required.");
          const price = findPrice(lock, input.priceId);
          const label = cleanText(input.priceLabel ?? "", "Price label", 200);
          const terms = cleanText(input.priceTerms ?? "", "Price terms", 1000);
          if (label === price.label && terms === price.terms) {
            throw new DecisionUserError("That change does not change the saved price.");
          }
          if (lock.prices.some((row) => row.id !== price.id && labelKey(row.label) === labelKey(label))) {
            throw new DecisionUserError("That price is already saved.");
          }
          change.priceId = price.id;
          change.priceLabel = label;
          change.priceTerms = terms;
        } else if (input.kind === "revise_client_wording") {
          const wording = cleanText(input.wording ?? "", "Client wording", 2000);
          if (wording === lock.clientWording) throw new DecisionUserError("That change does not change what the assistant may tell the client.");
          change.wording = wording;
        } else {
          throw new DecisionUserError("Unknown decision change.");
        }
        lock.changes.unshift(change);
        lock.updatedAt = change.createdAt;
        return change;
      }, true);
    },
    acceptDecisionChange(userId, decisionId, changeId) {
      return enqueue((data) => {
        const lock = findLock(data, userId, decisionId);
        const change = lock.changes.find((row) => row.id === changeId);
        if (!change) throw new DecisionUserError("Decision change not found");
        if (change.applied) return toRecord(lock);
        if (lock.status !== "approved") throw new DecisionUserError("Approve the decision before accepting a change.");
        const stamp = nowIso();
        if (change.kind === "revise_refund_rule") {
          if (!change.refundRule) throw new DecisionUserError("That refund rule could not be saved.");
          lock.refundRule = change.refundRule;
        } else if (change.kind === "revise_approved_date") {
          if (!change.approvedDate) throw new DecisionUserError("That date could not be saved.");
          lock.approvedDate = change.approvedDate;
        } else if (change.kind === "add_feature") {
          if (!change.featureTitle || !change.featureDetail) throw new DecisionUserError("That feature could not be saved.");
          if (lock.features.length >= MAX_FEATURES) throw new DecisionUserError("Feature limit reached.");
          if (lock.features.some((row) => labelKey(row.title) === labelKey(change.featureTitle ?? ""))) {
            throw new DecisionUserError("That feature is already saved.");
          }
          lock.features.push({
            id: randomUUID(),
            title: change.featureTitle,
            detail: change.featureDetail,
            createdAt: stamp
          });
        } else if (change.kind === "revise_feature") {
          if (!change.featureId || !change.featureTitle || !change.featureDetail) {
            throw new DecisionUserError("That feature could not be saved.");
          }
          const feature = findFeature(lock, change.featureId);
          if (lock.features.some((row) => row.id !== feature.id && labelKey(row.title) === labelKey(change.featureTitle ?? ""))) {
            throw new DecisionUserError("That feature is already saved.");
          }
          feature.title = change.featureTitle;
          feature.detail = change.featureDetail;
        } else if (change.kind === "add_price") {
          if (!change.priceLabel || !change.priceTerms) throw new DecisionUserError("That price could not be saved.");
          if (lock.prices.length >= MAX_PRICES) throw new DecisionUserError("Price limit reached.");
          if (lock.prices.some((row) => labelKey(row.label) === labelKey(change.priceLabel ?? ""))) {
            throw new DecisionUserError("That price is already saved.");
          }
          lock.prices.push({
            id: randomUUID(),
            label: change.priceLabel,
            terms: change.priceTerms,
            createdAt: stamp
          });
        } else if (change.kind === "revise_price") {
          if (!change.priceId || !change.priceLabel || !change.priceTerms) {
            throw new DecisionUserError("That price could not be saved.");
          }
          const price = findPrice(lock, change.priceId);
          if (lock.prices.some((row) => row.id !== price.id && labelKey(row.label) === labelKey(change.priceLabel ?? ""))) {
            throw new DecisionUserError("That price is already saved.");
          }
          price.label = change.priceLabel;
          price.terms = change.priceTerms;
        } else if (change.kind === "revise_client_wording") {
          if (!change.wording) throw new DecisionUserError("Client wording must be 1–2000 characters.");
          lock.clientWording = change.wording;
        } else {
          throw new DecisionUserError("Unknown decision change.");
        }
        change.status = "approved";
        change.applied = true;
        change.approvedAt = stamp;
        lock.updatedAt = stamp;
        return toRecord(lock);
      }, true);
    },
    addSupportRequest(input) {
      return enqueue((data) => {
        const request: SupportRequest = {
          id: randomUUID(),
          email: input.email,
          message: input.message,
          createdAt: nowIso()
        };
        data.supportRequests.push(request);
        if (data.supportRequests.length > MAX_SUPPORT) data.supportRequests.splice(0, data.supportRequests.length - MAX_SUPPORT);
        return { id: request.id };
      }, true);
    }
  };
}

export function isDecisionRefusal(error: unknown): error is DecisionRefusal {
  return error instanceof DecisionRefusal;
}
