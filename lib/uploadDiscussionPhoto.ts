import { supabase } from '@/supabaseClient';
import { authenticatedStorageUrl } from '@/lib/storageAuth';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Puts a photo in the discussion-media bucket and hands back its URL, or null
// if the upload failed. Same treatment as a chat photo — downscaled and
// JPEG-compressed first, uploaded as an arrayBuffer rather than an RN blob
// (blobs upload zero bytes).
export async function uploadDiscussionPhoto(
  groupId: string,
  aboutGroupId: string,
  uri: string,
  width: number
): Promise<string | null> {
  const rendered = await ImageManipulator.manipulate(uri)
    .resize({ width: Math.min(width, 1080) })
    .renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });

  const response = await fetch(saved.uri);
  const arrayBuffer = await response.arrayBuffer();

  // The owning group comes first in the path: the storage policy reads that
  // segment alone to decide who may look, so the group under discussion never
  // grants access to anything by being named second.
  const path = `${groupId}_${aboutGroupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { error } = await supabase.storage
    .from('discussion-media')
    .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
  if (error) return null;

  return authenticatedStorageUrl('discussion-media', path);
}
