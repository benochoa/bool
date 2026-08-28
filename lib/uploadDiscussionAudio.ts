import { supabase } from '@/supabaseClient';
import { authenticatedStorageUrl } from '@/lib/storageAuth';

// Puts a voice recording in the discussion-media bucket and hands back its URL,
// or null if the upload failed. No manipulation step — unlike a photo there's
// nothing to downscale; the recorder already writes a compressed .m4a.
export async function uploadDiscussionAudio(
  groupId: string,
  aboutGroupId: string,
  uri: string
): Promise<string | null> {
  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const path = `${groupId}_${aboutGroupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;

  const { error } = await supabase.storage
    .from('discussion-media')
    // audio/mp4 rather than audio/m4a: .m4a is an MPEG-4 container, and it's
    // the type browsers and both platforms actually recognise.
    .upload(path, arrayBuffer, { contentType: 'audio/mp4' });
  if (error) return null;

  return authenticatedStorageUrl('discussion-media', path);
}
