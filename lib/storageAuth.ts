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

// Only ever sent to our own Storage. Every URL that reaches this function comes
// out of a database column — profile_pic_url, image_urls, media_url — and every
// one of those is written by a client with nothing validating it. Attaching the
// token unconditionally meant anyone could point their own profile picture at a
// server they control and collect the access token of every person who rendered
// it: a full-privilege credential, for as long as it lives, from everyone who
// can see them — which is everyone in their city.
//
// A prefix test is enough because every stored URL is built by
// authenticatedStorageUrl above, and nothing else writes one. Anything else —
// an external URL, or a local file:// for a photo not yet uploaded — goes
// through bare, which is what it wanted anyway: headers mean nothing to file://.
const STORAGE_PREFIX = `${supabaseUrl}/storage/v1/object/authenticated/`;

// A source for expo-image or expo-audio.
export function authedSource(uri: string) {
  return accessToken && uri?.startsWith(STORAGE_PREFIX)
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