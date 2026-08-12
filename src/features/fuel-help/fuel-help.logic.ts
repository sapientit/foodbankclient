const PRE_PAYMENT_KEY = 'Pre-Payment';
const CONTACT_APPROVED_KEY = 'Contact approved';

/**
 * The two questions are owned by the client form, so the API deliberately
 * returns all answers and does not attempt to name them. Keep the keys here,
 * alongside the one screen allowed to read them.
 */
export function fuelAnswers(answers: Record<string, unknown>) {
  return {
    prePayment: answerText(answers[PRE_PAYMENT_KEY]),
    contactApproved: answerText(answers[CONTACT_APPROVED_KEY]),
  };
}

function answerText(answer: unknown): string {
  return typeof answer === 'string' && answer.trim() !== '' ? answer : 'Not answered';
}
