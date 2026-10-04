export class DecisionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionRefusal";
  }
}

export class DecisionUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionUserError";
  }
}

export type LockStatus = "draft" | "approved";

export type ChangeKind =
  | "revise_refund_rule"
  | "revise_approved_date"
  | "add_feature"
  | "revise_feature"
  | "add_price"
  | "revise_price"
  | "revise_client_wording";

export const REFUSED_DRAFT_REFUND =
  "Refused: the decision is not approved. Do not promise a refund.";

export const REFUSED_REFUND =
  "Refused: do not promise a refund that was not saved on the approved decision. promise_refund will not state it.";

export const REFUSED_DRAFT_DATE =
  "Refused: the decision is not approved. Do not state a date.";

export const REFUSED_DATE =
  "Refused: do not state a date that was not saved on the approved decision. state_date will not state it.";

export const REFUSED_DRAFT_FEATURE =
  "Refused: the decision is not approved. Do not promise a feature.";

export const REFUSED_FEATURE =
  "Refused: do not promise a feature that was not saved on the approved decision. promise_feature will not state it.";

export const REFUSED_DRAFT_PRICE =
  "Refused: the decision is not approved. Do not state a price.";

export const REFUSED_PRICE =
  "Refused: do not state a price that was not saved on the approved decision. state_price will not state it.";

export const REFUSED_REFUND_WRITE =
  "Refused: the approved refund rule stays as saved. Suggest a revise_refund_rule change and accept that change. save_refund_rule will not replace it.";

export const REFUSED_DATE_WRITE =
  "Refused: the approved date stays as saved. Suggest a revise_approved_date change and accept that change. save_approved_date will not replace it.";

export const REFUSED_NEW_FEATURE =
  "Refused: a feature that was not saved cannot be added after the decision is approved. Suggest an add_feature change and accept that change. save_approved_feature will not add it.";

export const REFUSED_NEW_PRICE =
  "Refused: a price that was not saved cannot be added after the decision is approved. Suggest an add_price change and accept that change. save_approved_price will not add it.";

export const REFUSED_WORDING =
  "Refused: what the assistant may tell the client stays as approved. Suggest a revise_client_wording change and accept that change. write_client_wording will not replace it.";

export const RECORD_GUIDANCE =
  "Answer only from this decision lock. Tell the client only what clientWording and mayTellClient allow. If they disagree, follow the stricter limit. A refund, date, feature, or price may be stated only when it is in this saved record and the lock is approved. Draft status is not an approved commitment. Proposed decision changes are not authorization. promise_refund, state_date, promise_feature, and state_price refuse a statement that was not saved.";

export type FeatureFact = {
  id: string;
  title: string;
  detail: string;
};

export type PriceFact = {
  id: string;
  label: string;
  terms: string;
};

export type MayTellClient = {
  script: string | null;
  refundRule: string | null;
  approvedDate: string | null;
  features: FeatureFact[];
  prices: PriceFact[];
  limits: string[];
};

export function labelKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function assertRefundPromise(input: { status: LockStatus; saved: string | null; stated: string }): void {
  if (input.status === "approved" && input.saved && labelKey(input.saved) === labelKey(input.stated)) return;
  if (input.status !== "approved") throw new DecisionRefusal(REFUSED_DRAFT_REFUND);
  throw new DecisionRefusal(REFUSED_REFUND);
}

export function assertDatePromise(input: { status: LockStatus; saved: string | null; stated: string }): void {
  if (input.status === "approved" && input.saved && labelKey(input.saved) === labelKey(input.stated)) return;
  if (input.status !== "approved") throw new DecisionRefusal(REFUSED_DRAFT_DATE);
  throw new DecisionRefusal(REFUSED_DATE);
}

export function assertFeaturePromise(status: LockStatus, found: boolean): void {
  if (status === "approved" && found) return;
  if (status !== "approved") throw new DecisionRefusal(REFUSED_DRAFT_FEATURE);
  throw new DecisionRefusal(REFUSED_FEATURE);
}

export function assertPricePromise(status: LockStatus, found: boolean): void {
  if (status === "approved" && found) return;
  if (status !== "approved") throw new DecisionRefusal(REFUSED_DRAFT_PRICE);
  throw new DecisionRefusal(REFUSED_PRICE);
}

export function assertRefundWrite(status: LockStatus, current: string | null, next: string): void {
  if (status === "approved" && current !== next) throw new DecisionRefusal(REFUSED_REFUND_WRITE);
}

export function assertDateWrite(status: LockStatus, current: string | null, next: string): void {
  if (status === "approved" && current !== next) throw new DecisionRefusal(REFUSED_DATE_WRITE);
}

export function assertNewFeature(status: LockStatus): void {
  if (status === "approved") throw new DecisionRefusal(REFUSED_NEW_FEATURE);
}

export function assertNewPrice(status: LockStatus): void {
  if (status === "approved") throw new DecisionRefusal(REFUSED_NEW_PRICE);
}

export function assertWordingWrite(status: LockStatus, current: string | null, next: string): void {
  if (status === "approved" && current !== next) throw new DecisionRefusal(REFUSED_WORDING);
}

export function buildMayTellClient(input: {
  status: LockStatus;
  clientWording: string | null;
  refundRule: string | null;
  approvedDate: string | null;
  features: FeatureFact[];
  prices: PriceFact[];
}): MayTellClient {
  const features = input.features.map((feature) => ({
    id: feature.id,
    title: feature.title,
    detail: feature.detail
  }));
  const prices = input.prices.map((price) => ({
    id: price.id,
    label: price.label,
    terms: price.terms
  }));
  const limits = [
    "Tell the client only the client wording and the facts in this record.",
    "Do not promise a refund that is not the saved refund rule.",
    "Do not state a date that is not the saved approved date.",
    "Do not promise a feature that is not saved.",
    "Do not state a price that is not saved.",
    "Do not present a proposed decision change as something the client was told."
  ];
  if (input.status !== "approved") {
    limits.push("This decision is still a draft. Do not present it to the client as an approved commitment.");
  }
  if (input.status === "approved" && input.refundRule) {
    limits.push(`You may state this refund rule: ${input.refundRule}`);
  } else {
    limits.push("Do not promise a refund.");
  }
  if (input.status === "approved" && input.approvedDate) {
    limits.push(`You may state this date: ${input.approvedDate}`);
  } else {
    limits.push("Do not state a date.");
  }
  if (features.length === 0 || input.status !== "approved") {
    limits.push("Do not promise a feature.");
  }
  for (const feature of features) {
    if (input.status === "approved") limits.push(`You may promise this feature: ${feature.title}`);
  }
  if (prices.length === 0 || input.status !== "approved") {
    limits.push("Do not state a price.");
  }
  for (const price of prices) {
    if (input.status === "approved") limits.push(`You may state this price: ${price.label}`);
  }
  return {
    script: input.clientWording,
    refundRule: input.refundRule,
    approvedDate: input.approvedDate,
    features,
    prices,
    limits
  };
}
