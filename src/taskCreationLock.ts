const TASK_CREATION_LOCK_PREFIX = 'task-create:';

export function taskCreationLockKey(vesselId: string) {
  return `${TASK_CREATION_LOCK_PREFIX}${vesselId}`;
}

export function isTaskCreationLockKey(sectionKey: string) {
  return sectionKey.startsWith(TASK_CREATION_LOCK_PREFIX) && sectionKey.length > TASK_CREATION_LOCK_PREFIX.length;
}

export function taskCreationLockMatchesVessel(sectionKey: string, vesselId: string) {
  return sectionKey === taskCreationLockKey(vesselId);
}
