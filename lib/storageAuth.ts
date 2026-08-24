import { supabase, supabaseUrl } from '@/supabaseClient';

// Every bucket is private, so a stored URL is worthless on its own: pasted into
// a browser it answers 401. Reaching an object means sending the viewer's JWT,
// and Storage then applies the RLS policies on storage.objects to decide
// whether this person may see this file.
//
// The token is kept here rather than read through a hook because fifteen render
// sites need it, several of them inside lists — threading a hook through all of
// them to produce one header is churn for nothing. It's mirrored from the auth
// client, so it follows sign-in, sign-out and refresh without anything else
// having to notice.
let accessToken: string | null = null;

supabase.auth.getSession().then(({ data }) => {
  accessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

// Where an object lives now that public URLs are gone. Written onto the row at
// upload time exactly as the public URL used to be, so nothing downstream has
// to know the difference.
export function authenticatedStorageUrl(bucket: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${path}`;
}

// A source for expo-image or expo-audio. Local URIs (a photo just picked, not
// yet uploaded) pass through harmlessly — headers mean nothing to file://.
export function authedSource(uri: string) {
  return accessToken
    ? { uri, headers: { Authorization: `Bearer ${accessToken}` } }
    : { uri };
}

// For the one place that fetches bytes itself rather than handing a URL to a
// component — saving a chat photo to the camera roll. Asks the auth client
// directly, since a save can be the first thing to happen after a resume and
// the mirrored copy above may not have caught up.
export async function storageHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}