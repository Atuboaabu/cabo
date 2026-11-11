/**
 * Presentation-only validation. A matching confirmation is not proof of
 * account ownership or password policy compliance; the backend decides both.
 */
export function passwordsMatch(password, confirmation) {
  return typeof password === 'string' && password.length > 0 &&
    typeof confirmation === 'string' && password === confirmation;
}

/** Client-side resend cooldown, not a substitute for backend rate limiting. */
export const VERIFICATION_COOLDOWN_MS = 60_000;
export function resendSecondsRemaining(until, now = Date.now()) {
  return Number.isFinite(until) ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** Only show mismatch after the user starts entering confirmation. */
export function passwordConfirmationFeedback(password, confirmation) {
  if (typeof confirmation !== 'string' || confirmation.length === 0) return '';
  return passwordsMatch(password, confirmation) ? '' : '两次输入的密码不一致';
}
