/**
 * Presentation-only validation. A matching confirmation is not proof of
 * account ownership or password policy compliance; the backend decides both.
 */
export function passwordsMatch(password, confirmation) {
  return typeof password === 'string' && password.length > 0 &&
    typeof confirmation === 'string' && password === confirmation;
}
