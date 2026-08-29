import { supabase } from '@/supabaseClient';

// Everything this person has in Storage, removed through the Storage API —
// Postgres refuses a direct delete against storage.objects, so delete_my_account
// can't do it and this runs just before it.
//
// Order matters: every storage policy asks who you are — your own folder, a
// group you lead, an object you uploaded — and delete_my_account removes the
// rows those policies read. Run afterwards, every delete would be refused.

interface MediaPath {
  bucket_id: string;
  name: string;
}

export async function deleteMyMedia(userId: string): Promise<void> {
  // Asked of storage.objects rather than assembled from folder names. Chat and
  // discussion media is filed under the conversation, not the person, so
  // someone's own files are scattered across every thread they ever wrote in —
  // there is no folder to list that would find them. This sweep is what closes
  // the gap that left a departing user's photos and videos behind.
  const { data: mine } = await supabase.rpc('my_media_paths');

  const byBucket = new Map<string, string[]>();
  for (const row of (mine ?? []) as MediaPath[]) {
    byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row.name]);
  }
  for (const [bucket, paths] of byBucket) {
    // remove() takes a batch per bucket, so this is one call each rather than
    // one per file.
    await supabase.storage.from(bucket).remove(paths);
  }

  // A group dies with its leader, so its photos go too. Kept as its own pass
  // because the sweep above only finds what THIS person uploaded: a photo added
  // by a previous leader, before the group was handed over, belongs to someone
  // else and would otherwise outlive the group it belongs to.
  const { data: ledGroups } = await supabase
    .from('groups')
    .select('id')
    .eq('created_by', userId);

  for (const group of ledGroups ?? []) {
    const { data: files } = await supabase.storage.from('groups').list(group.id);
    if (files?.length) {
      await supabase.storage.from('groups').remove(files.map(f => `${group.id}/${f.name}`));
    }
  }
}
