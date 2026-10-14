export type {
  EmailAddress,
  EmailMessage,
  EmailProvider,
  EmailProviderId,
  EmailReceipt,
  EmailTag,
} from './contracts';
export { getEmailProvider } from './registry';
export {
  DEFAULT_BRAND_NAME,
  buildLetterEmail,
  escapeHtml,
  type LetterEmailInput,
} from './template';
export { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';
