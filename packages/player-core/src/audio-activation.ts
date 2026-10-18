type ResumableContext = Pick<AudioContext, "state" | "resume">;

const activations = new WeakMap<ResumableContext, Promise<void>>();

export function audioActivationPending(context: ResumableContext): boolean {
  return activations.has(context);
}

export function resumeAudioContext(context: ResumableContext, settled: () => void): void {
  if (context.state !== "suspended" || activations.has(context)) return;
  const pending = context.resume();
  activations.set(context, pending);
  const finish = () => {
    if (activations.get(context) !== pending) return;
    activations.delete(context);
    settled();
  };
  void pending.then(finish, finish);
}
