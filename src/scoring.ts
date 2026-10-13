/**
 * Whether the dialogs offer to score a result against a bid workbook. It is the estimator's
 * check on the automation, not something a sub needs, so it is off until turned on (More menu).
 * Kept per browser.
 */
const KEY = 'takeoff-ai.scoring';

export function scoringOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setScoringOn(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the setting lasts until the page closes at most.
  }
}
