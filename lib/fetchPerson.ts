import { supabase } from '@/supabaseClient';

export interface PersonData {
  name: string;
  qa: { question: string; answer: string }[];
  imageUrls: string[];
}

export async function fetchPerson(personId: string): Promise<PersonData | null> {

  // Fetch text data from Postgres
  const { data, error } = await supabase
    .from('profiles')
    .select('name, qa')
    .eq('id', personId)
    .single();
  if (error || !data) return null;

  // List images from Storage.
  // '?v=' makes the URL change whenever the file changes, so caches
  // (CDN, phone image cache) don't keep showing an overwritten photo.
  const { data: files } = await supabase.storage.from('people').list(personId);
  const imageUrls = (files ?? []).map(
    file => supabase.storage.from('people').getPublicUrl(`${personId}/${file.name}`).data.publicUrl + '?v=' + file.updated_at
  );

  return {
    name: data.name,
    qa: data.qa,
    imageUrls,
  };
}