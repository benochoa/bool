import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Puts a photo in the chat-media bucket and hands back its public URL, or null
// if the upload failed. Same treatment the post photos get — downscaled and
// JPEG-compressed first, uploaded as an arrayBuffer rather than an RN blob
// (blobs upload zero bytes).
export async function uploadChatPhoto(
  myGroupId: string,
  otherGroupId: string,
  uri: string,
  width: number
): Promise<string | null> {
  const rendered = await ImageManipulator.manipulate(uri)
    .resize({ width: Math.min(width, 1080) })
    .renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });

  const response = await fetch(saved.uri);
  const arrayBuffer = await response.arrayBuffer();

  // Filed under the chat, one object per send. Unlike a profile picture or a
  // card slot there's nothing here to overwrite, so the name carries the time
  // plus a short random tail rather than a fixed slot number — and being unique
  // means the URL needs no cache-buster.
  const [g1, g2] = canonicalPair(myGroupId, otherGroupId);
  const path = `${g1}_${g2}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
  if (error) return null;

  return supabase.storage.from('chat-media').getPublicUrl(path).data.publicUrl;
}