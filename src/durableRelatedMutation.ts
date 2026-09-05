export type RelatedMutationLease = {
  sectionKey: string;
  leaseOwnerId: string;
  ownerUserId: string;
  authorizationEpoch: string;
  generation: number;
};

export function relatedMutationLeaseMatches(expected: RelatedMutationLease | null | undefined, actual: RelatedMutationLease | null | undefined): boolean {
  return Boolean(expected && actual
    && expected.sectionKey === actual.sectionKey
    && expected.leaseOwnerId === actual.leaseOwnerId
    && expected.ownerUserId === actual.ownerUserId
    && expected.authorizationEpoch === actual.authorizationEpoch
    && expected.generation === actual.generation);
}

export function createDurableRelatedMutationHandoff(lease: RelatedMutationLease, isCurrent: () => boolean, label: string) {
  let resolve!: (releaseAllowed: boolean) => void;
  const handoff = {
    lease: Object.freeze({ ...lease }),
    isCurrent,
    label,
    pending: true,
    confirmed: false,
    promise: new Promise<boolean>(done => { resolve = done; }),
    finish(releaseAllowed: boolean, confirmed = false) {
      if (!handoff.pending) return;
      handoff.pending = false;
      handoff.confirmed = confirmed;
      resolve(releaseAllowed);
    },
  };
  return handoff;
}

export type DurableRelatedMutationHandoff = ReturnType<typeof createDurableRelatedMutationHandoff>;

export function relatedMutationFailureMessage(input: {
  label: string;
  message: string;
  applied: boolean;
  confirmed: boolean;
  definitivelyRejected: boolean;
}): string {
  if (input.confirmed) return `${input.label}已由雲端確認，畫面更新尚未完成；請勿重複操作。${input.message}`;
  if (input.applied && !input.definitivelyRejected) return `${input.label}結果尚未確認，請勿重複操作；目前修改仍保留。${input.message}`;
  return `${input.label}未完成：${input.message}`;
}
