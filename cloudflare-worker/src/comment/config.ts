export const IP_LIMIT_COUNT = 3;
export const IP_LIMIT_WINDOW = 60;
export const EMAIL_LIMIT_COUNT = 5;
export const EMAIL_LIMIT_WINDOW = 600;
export const GLOBAL_LIMIT_COUNT = 20;
export const GLOBAL_LIMIT_WINDOW = 60;

export const VALID_STATUSES = ['pending', 'approved', 'featured', 'spam'] as const;
export const VALID_ACTIONS = ['approve', 'feature', 'spam', 'restore'] as const;
export const ADMIN_SINGLE_ACTIONS: readonly string[] = [...VALID_ACTIONS, 'delete'];
export const ADMIN_BATCH_ACTIONS: readonly string[] = [
  ...VALID_ACTIONS.filter((a) => a !== 'restore'),
  'delete',
];

export const RATE_LIMIT_ACTION = 'submit_message';

export const SPAM_SOURCE_THRESHOLD_IP = 3;
export const SPAM_SOURCE_THRESHOLD_EMAIL = 2;
export const SPAM_SOURCE_THRESHOLD_NICKNAME = 3;
export const SPAM_CONTENT_THRESHOLD = 1;
