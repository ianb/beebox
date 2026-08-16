export interface MutationActivity {
  active(): number;
  start(): () => void;
}

export function createMutationActivity(): MutationActivity {
  let active = 0;

  return {
    active: () => active,
    start(): () => void {
      active++;
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        active--;
      };
    },
  };
}
