import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/supabaseClient';

// The EAS project id is what getExpoPushTokenAsync mints tokens against. It
// lands in app.json when `eas init` links the project; until then push is
// simply off and the rest of the app runs untouched.
function projectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

async function deviceToken(): Promise<string | null> {
  const id = projectId();
  if (!id) {
    console.log('[push] no EAS projectId in app.json — run `npx eas-cli@latest init` to enable push');
    return null;
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data;
  } catch (e) {
    // Expected wherever remote push can't work: Expo Go on Android (dropped in
    // SDK 53) and simulators. In-app banners don't come through here at all.
    console.log('[push] no push token for this device:', e);
    return null;
  }
}

// Idempotent; runs whenever a signed-in session lands. The token is the row's
// key, so a device that switches accounts re-points its row at the new user
// rather than leaving the old one subscribed.
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'android') {
    // Android shows nothing without a channel; 'default' is the channelId the
    // notify edge function names on every send.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return;

  const token = await deviceToken();
  if (!token) return;
  await supabase.from('push_tokens').upsert(
    { token, user_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'token' }
  );
}

// Called just before signing out — deleting the row needs the session — so a
// signed-out device stops getting the old account's pushes.
export async function unregisterPushToken(): Promise<void> {
  const token = await deviceToken();
  if (!token) return;
  await supabase.from('push_tokens').delete().eq('token', token);
}
