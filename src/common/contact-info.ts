import { CONTACT_INFO_MESSAGE, findContactInfo } from '@/lib/validation/contact-info';
import { invalid } from './api-error.js';

/**
 * Refuses user-written text that carries a phone number or email, so contact details
 * only change hands through Basera (and the Contact Pass). Call it on every free-text field.
 */
export function assertNoContactInfo(...texts: (string | null | undefined)[]) {
  if (texts.some((t) => findContactInfo(t))) throw invalid(CONTACT_INFO_MESSAGE);
}
