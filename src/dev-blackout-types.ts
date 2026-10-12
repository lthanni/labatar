export type DevBlackoutStatus = {
  available: boolean;
  gameRunning: boolean;
  active: boolean;
  busy: boolean;
  restorePending: boolean;
  testedCharacter: string | null;
  error: string | null;
};
