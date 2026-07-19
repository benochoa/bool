import { supabase } from '@/supabaseClient';

export interface PersonData {
  name: string;
  qa: { question: string; answer: string }[];
  imageUrls: string[];
}

export async function fetchPerson(personId: string): Promise<PersonData | null> {

  // Single round trip — image_urls is written at upload time, so Storage
  // never needs to be asked what files exist.
  const { data, error } = await supabase
    .from('profiles')
    .select('name, qa, image_urls')
    .eq('id', personId)
    .single();
  if (error || !data) return null;

  return {
    name: data.name,
    qa: data.qa,
    imageUrls: data.image_urls ?? [],
  };
}