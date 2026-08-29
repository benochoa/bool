import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';
import { authenticatedStorageUrl } from '@/lib/storageAuth';

// Puts a video in the chat-media bucket and hands back its URL, or null if the
// upload failed. No manipulation step: expo-image-manipulator is images only,
// and the picker has already done the work — videoMaxDuration caps the clip and
// videoQuality transcodes it on the way out, which is what keeps this inside
// Expo Go rather than needing a native transcoder and a development build.
//
// The container is whatever the platform produced: iOS hands back QuickTime,
// Android mp4. Both are allowed on the bucket, and storing the type it actually
// is means the player doesn't have to guess.
export async function uploadChatVideo(
  myGroupId: string,
  otherGroupId: string,
  uri: string,
  mimeType?: string | null
): Promise<string | null> {
  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const contentType = mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';

  // Filed under the chat, one object per send — the same shape the photo and
  // audio uploads use, and unique enough to need no cache-buster.
  const [g1, g2] = canonicalPair(myGroupId, otherGroupId);
  const path = `${g1}_${g2}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, arrayBuffer, { contentType });
  if (error) return null;

  return authenticatedStorageUrl('chat-media', path);
}
