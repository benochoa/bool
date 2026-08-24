import { supabase } from '@/supabaseClient';

// Everything this person has in Storage, removed through the Storage API —
// Postgres refuses a direct delete against storage.objects, so delete_my_account
// can't do it and this runs just before it.
//
// Order matters: both buckets are guarded by policies that ask who you are
// (your own folder, or a group you lead), and delete_my_account removes the
// rows those policies read. Run afterwards, every delete would be refused.
//
// list() rather than the known filenames: this is the one path where missing a
// leftover file means keeping someone's photo after they asked to be forgotten,
// so it's worth asking Storage what's actually there.
export async function deleteMyMedia(userId: string): Promise<void> {
  const { data: myFiles } = await supabase.storage.from('people').list(userId);
  if (myFiles?.length) {
    await supabase.storage.from('people').remove(myFiles.map(f => `${userId}/${f.name}`));
  }

  // A group dies with its leader, so its photos go too.
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