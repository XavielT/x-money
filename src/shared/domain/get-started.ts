// A clean install starts with two empty accounts ("Cash" and "Card"); they do not count as the user's first account.
export function ownAccountCount(accounts: readonly { id: string; name: string; initialBalance: number }[], starting: readonly { id: string; name: string; initialBalance: number }[]): number {
  return accounts.filter((a) => !starting.some((d) => d.id === a.id && d.name === a.name && a.initialBalance === d.initialBalance)).length;
}

// The three-step card at the top of Home for a brand-new install. No tutorial, no sample data: the steps tick themselves.
export type StartStep = 'account' | 'movement' | 'features';

export interface GetStartedInput {
  accounts: number; // every account, including the two a clean install starts with
  ownAccounts: number; // accounts the user added or changed (not the untouched starting ones)
  movements: number;
  modulesTouched: boolean; // the user flipped at least one module switch
  skipped: boolean; // pressed "Skip" on the third step
  hidden: boolean; // pressed "Hide"
}

export interface GetStartedState {
  visible: boolean;
  steps: { id: StartStep; done: boolean }[];
}

export function getStarted(i: GetStartedInput): GetStartedState {
  const steps: GetStartedState['steps'] = [
    { id: 'account', done: i.ownAccounts > 0 },
    { id: 'movement', done: i.movements > 0 },
    { id: 'features', done: i.modulesTouched || i.skipped },
  ];
  // existing users (accounts AND movements) never see it; a hidden card stays hidden; all done = it goes away by itself
  const existingUser = i.accounts > 0 && i.movements > 0;
  return { visible: !i.hidden && !existingUser && steps.some((s) => !s.done), steps };
}
