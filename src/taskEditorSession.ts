export type TaskEditorSessionCoordinator<T> = {
  isCurrent: (token: number) => boolean;
  consumeIfCurrent: (token: number) => T | undefined;
};

export function consumeCurrentTaskEditorSession<T>(coordinator: TaskEditorSessionCoordinator<T>, token: number): T | undefined {
  if (!coordinator.isCurrent(token)) return undefined;
  return coordinator.consumeIfCurrent(token);
}
