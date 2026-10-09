export type DevBlackoutStatus = {
  available: boolean;
  gameRunning: boolean;
  active: boolean;
  busy: boolean;
  restorePending: boolean;
  error: string | null;
};
