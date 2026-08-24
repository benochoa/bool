import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Exported because Storage URLs are built by hand: the buckets are private, so
// the app addresses objects through /object/authenticated/ rather than through
// getPublicUrl.
export const supabaseUrl = 'https://vsgdhfwhpiucplkraizw.supabase.co';
const supabaseAnonKey = 'sb_publishable_Z-ynMkiqSd9dq76lD1G5eg_odoEyQoK';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
