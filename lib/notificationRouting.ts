import type { Router } from 'expo-router';

// The payload both delivery paths carry: the notify edge function puts it on
// every push, and the in-app banner builds the same shape, so one router
// serves a tap on either.
export interface NotificationData {
  type: 'suggestion' | 'sent' | 'received' | 'match' | 'message' | 'joined' | 'left' | 'removed' | 'discussion';
  // The group of yours the notification is about — a push tap makes it the
  // acting-as group before navigating.
  groupId: string;
  // The group on the other side, for the two types that open a chat.
  otherGroupId?: string;
  // Discussion only: which tab the candidate's tile is on, worked out by the
  // notify function. A discussion has no screen of its own to open.
  surface?: 'pending' | 'received';
}

// Push data comes back from the OS as loose JSON, so it's checked, not trusted.
export function parseNotificationData(raw: unknown): NotificationData | null {
  const d = raw as Partial<NotificationData> | null;
  if (!d || typeof d.groupId !== 'string') return null;
  switch (d.type) {
    case 'suggestion':
    case 'sent':
    case 'received':
    case 'joined':
    case 'left':
    case 'removed':
      return { type: d.type, groupId: d.groupId };
    case 'match':
    case 'message':
      return typeof d.otherGroupId === 'string'
        ? { type: d.type, groupId: d.groupId, otherGroupId: d.otherGroupId }
        : null;
    case 'discussion':
      return {
        type: 'discussion',
        groupId: d.groupId,
        otherGroupId: typeof d.otherGroupId === 'string' ? d.otherGroupId : undefined,
        // Anything but 'received' lands on Pending, which is also where a
        // payload from an older build with no surface at all goes.
        surface: d.surface === 'received' ? 'received' : 'pending',
      };
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
    // The roster is what changed, and that's on the group's own page.
    case 'joined':
    case 'left':
    case 'removed':
      router.navigate('/groups');
      break;
    case 'match':
    case 'message':
      router.navigate({ pathname: '/chats', params: { openChat: data.otherGroupId } });
      break;
    // A discussion has no route of its own — it opens from a button on a tile.
    // So the tap lands on the tab that tile is on, carrying the group as a
    // param the screen consumes to open the panel once its list has loaded.
    case 'discussion':
      if (data.surface === 'received') {
        router.navigate({
          pathname: '/received',
          params: { openDiscussion: data.otherGroupId },
        });
      } else {
        router.navigate({
          pathname: '/',
          params: { view: 'pending', openDiscussion: data.otherGroupId },
        });
      }
      break;
  }
}
