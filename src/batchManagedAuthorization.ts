export type BatchManagedAuthorization = Readonly<{
  session: number;
  authorizationEpoch: string;
  userId: string;
  cloudIdentity: string;
}>;

export function createBatchManagedAuthorization(input: BatchManagedAuthorization): BatchManagedAuthorization {
  return Object.freeze({ ...input });
}

export function batchMutationSessionIsCurrent(input: {
  renderedAuthorization: BatchManagedAuthorization | null;
  currentAuthorization: BatchManagedAuthorization | null;
  currentSession: number;
  liveAuthorizationEpoch: string;
  liveUserId: string;
  currentCloudIdentity: string;
}): boolean {
  const rendered = input.renderedAuthorization;
  return Boolean(
    rendered
    && input.currentAuthorization === rendered
    && rendered.session === input.currentSession
    && rendered.authorizationEpoch === input.liveAuthorizationEpoch
    && rendered.userId === input.liveUserId
    && rendered.cloudIdentity === input.currentCloudIdentity
  );
}
