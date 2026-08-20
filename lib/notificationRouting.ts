import type { Router } from 'expo-router';

// The payload both delivery paths carry: the notify edge function puts it on
// every push, and the in-app banner builds the same shape, so one router
// serves a tap on either.
export interface NotificationData {
  type: 'suggestion' | 'sent' | 'received' | 'match' | 'message';
  // The group of yours the notification is about — a push tap makes it the
  // acting-as group before navigating.
  groupId: string;
  // The group on the other side, for the two types that open a chat.
  otherGroupId?: string;
}

// Push data comes back from the OS as loose JSON, so it's checked, not trusted.
export function parseNotificationData(raw: unknown): NotificationData | null {
  const d = raw as Partial<NotificationData> | null;
  if (!d || typeof d.groupId !== 'string') return null;
  switch (d.type) {
    case 'suggestion':
    case 'sent':
    case 'received':
      return { type: d.type, groupId: d.groupId };
    case 'match':
    case 'message':
      return typeof d.otherGroupId === 'string'
        ? { type: d.type, groupId: d.groupId, otherGroupId: d.otherGroupId }
        : null;
    default:
      return null;
  }
}

// Where a tap lands: suggestion movement on the Pending sub-tab, requests on
// Received, matches and messages inside the chat itself. The params are
// consumed by their screens (index's `view`, chats' `openChat`).
export function routeToNotification(router: Router, data: NotificationData) {
  switch (data.type) {
    case 'suggestion':
    case 'sent':
      router.navigate({ pathname: '/', params: { view: 'pending' } });
      break;
    case 'received':
      router.navigate('/received');
      break;
    case 'match':
    case 'message':
      router.navigate({ pathname: '/chats', params: { openChat: data.otherGroupId } });
      break;
  }
}
