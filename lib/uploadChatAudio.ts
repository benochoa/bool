import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';
import { authenticatedStorageUrl } from '@/lib/storageAuth';

// Puts a voice recording in the chat-media bucket and hands back its public
// URL, or null if the upload failed. No manipulation step — unlike a photo
// there's nothing to downscale; the recorder already writes a compressed .m4a.
export async function uploadChatAudio(
  myGroupId: string,
  otherGroupId: string,
  uri: string
): Promise<string | null> {
  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const [g1, g2] = canonicalPair(myGroupId, otherGroupId);
  const path = `${g1}_${g2}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;

  const { error } = await supabase.storage
    .from('chat-media')
    // audio/mp4 rather than audio/m4a: .m4a is an MPEG-4 container, and it's
    // the type browsers and both platforms actually recognise.
    .upload(path, arrayBuffer, { contentType: 'audio/mp4' });
  if (error) return null;

  return authenticatedStorageUrl('chat-media', path);
}