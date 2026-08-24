import { Identifiers } from '@/lib/identifiers';
import { supabase } from '@/supabaseClient';

export interface GroupMember {
  id: string;
  name: string;
  profilePicUrl: string | null;
}

export interface GroupData {
  name: string;
  qa: { question: string; answer: string }[];
  members: GroupMember[];
  imageUrls: string[];
  created_by: string | null;
  imageAspectRatio: number | null;
  // Stored card order as slot keys; null on rows saved before it was editable.
  cardOrder: string[] | null;
  identifiers: Identifiers;
}

export async function fetchGroup(groupId: string): Promise<GroupData | null> {

  // Single round trip: the group row, member names (joined server-side), and
  // the photo URLs — image_urls is written at upload time, so Storage never
  // needs to be asked what files exist.
  const { data, error } = await supabase
    .from('groups')
    // invite_code is deliberately absent: the column is revoked from clients,
    // and the leader reads their own through fetchInviteCode.
    .select('name, qa, created_by, image_urls, image_aspect_ratio, card_order, age, gender, city, college, memberships(person_id, status, profiles(name, profile_pic_url))')
    .eq('id', groupId)
    .single();
  if (error || !data) return null;

  const members = (data.memberships ?? [])
    // Only active members define the group; left/kicked rows are kept for
    // history but excluded here.
    .filter(row => (row as { status?: string }).status === 'active')
    .map(row => {
      // memberships.person_id -> profiles.id is many-to-one, so PostgREST
      // embeds profiles as a single object — the inferred array type here is
      // wrong (this client has no generated schema to tell it the cardinality).
      const profile = row.profiles as unknown as { name: string; profile_pic_url: string | null } | null;
      return { id: row.person_id, name: profile?.name ?? '...', profilePicUrl: profile?.profile_pic_url ?? null };
    });

  return {
    name: data.name,
    qa: data.qa,
    members,
    imageUrls: data.image_urls ?? [],
    created_by: data.created_by,
    imageAspectRatio: data.image_aspect_ratio ?? null,
    cardOrder: data.card_order ?? null,
    identifiers: {
      age: data.age ?? null,
      gender: data.gender ?? null,
      city: data.city ?? null,
      college: data.college ?? null,
    },
  };
}