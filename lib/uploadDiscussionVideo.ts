import { supabase } from '@/supabaseClient';
import { authenticatedStorageUrl } from '@/lib/storageAuth';

// Puts a video in the discussion-media bucket and hands back its URL, or null if
// the upload failed. Same treatment as uploadChatVideo — the picker has already
// capped and transcoded it — differing only in the bucket and in the folder,
// which names the owning group first because a discussion has one owner rather
// than an unordered pair.
export async function uploadDiscussionVideo(
  groupId: string,
  aboutGroupId: string,
  uri: string,
  mimeType?: string | null
): Promise<string | null> {
  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const contentType = mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';

  const path = `${groupId}_${aboutGroupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase.storage
    .from('discussion-media')
    .upload(path, arrayBuffer, { contentType });
  if (error) return null;

  return authenticatedStorageUrl('discussion-media', path);
}
