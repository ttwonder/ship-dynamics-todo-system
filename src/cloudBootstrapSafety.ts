export type CloudBootstrapSafetyState = {
  cloudConfigured: boolean;
  cloudBootstrapped: boolean;
  cloudWriteBlocked: boolean;
  activeCloudIdentity: string;
  currentCloudIdentity: string;
  cloudInitializationAllowed: boolean;
  localInitializationAllowed: boolean;
};

export function mayPersistLocalSnapshot(state: CloudBootstrapSafetyState): boolean {
  if (!state.cloudConfigured) return state.cloudBootstrapped && state.localInitializationAllowed;
  return state.cloudBootstrapped
    && Boolean(state.activeCloudIdentity)
    && state.activeCloudIdentity === state.currentCloudIdentity;
}

export function mayOfferFirstRunInitialization(state: CloudBootstrapSafetyState): boolean {
  if (!state.cloudBootstrapped) return false;
  return !state.cloudConfigured && state.localInitializationAllowed;
}

export function trustedMatchingCloudIdentity(cachedIdentity: string, currentIdentity: string): string {
  return Boolean(cachedIdentity) && cachedIdentity === currentIdentity ? currentIdentity : '';
}
