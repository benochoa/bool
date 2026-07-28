import { supabase } from '@/supabaseClient';

export interface PersonData {
  name: string;
  qa: { question: string; answer: string }[];
  imageUrls: string[];
  profilePicUrl: string | null;
  imageAspectRatio: number | null;
}

export async function fetchPerson(personId: string): Promise<PersonData | null> {

  // Single round trip — image_urls is written at upload time, so Storage
  // never needs to be asked what files exist.
  const { data, error } = await supabase
    .from('profiles')
    .select('name, qa, image_urls, profile_pic_url, image_aspect_ratio')
    .eq('id', personId)
    .single();
  if (error || !data) return null;

  return {
    name: data.name,
    qa: data.qa,
    imageUrls: data.image_urls ?? [],
    profilePicUrl: data.profile_pic_url ?? null,
    imageAspectRatio: data.image_aspect_ratio ?? null,
  };
}