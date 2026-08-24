import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { parseNotificationData, NotificationData, routeToNotification } from '@/lib/notificationRouting';
import { registerPushToken } from '@/lib/registerPushToken';

// While the app is open the OS stays quiet: the in-app banner covers the
// acting-as group, and the other groups are deliberately silent until the app
// is backgrounded — which is where these pushes come back in.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Headless: registers this device's token and turns push taps into navigation.
// Mounted under CurrentGroupProvider so a tap can switch the acting-as group —
// pushes arrive for all your groups, not just the one you're acting as.
export function PushNotificationManager() {
  const router = useRouter();
  const { session } = useSession();
  const { myGroupIds, loadingGroups, setCurrentGroupId } = useCurrentGroup();
  // Taps park here until the group list has loaded — a cold start's tap
  // arrives before it's known whether that group is still one of yours.
  const [pendingTap, setPendingTap] = useState<NotificationData | null>(null);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) registerPushToken();
  }, [userId]);

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const data = parseNotificationData(response.notification.request.content.data);
      if (data) setPendingTap(data);
    };
    // The tap that launched the app fired before any listener could exist.
    let stale = false;
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!stale && response) handle(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      stale = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pendingTap || loadingGroups) return;
    setPendingTap(null);
    const stillMine = myGroupIds.includes(pendingTap.groupId);
    // Dropped rather than routed if you've since left the group — except a
    // removal, whose whole point is that the group isn't yours any more. That
    // one opens the Groups tab without switching to a group you're not in.
    if (!stillMine && pendingTap.type !== 'removed') return;
    if (stillMine) setCurrentGroupId(pendingTap.groupId);
    routeToNotification(router, pendingTap);
  }, [pendingTap, loadingGroups, myGroupIds, setCurrentGroupId, router]);

  return null;
}
