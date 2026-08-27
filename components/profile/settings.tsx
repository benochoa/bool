import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { deleteMyMedia } from '@/lib/deleteMyMedia';
import { unregisterPushToken } from '@/lib/registerPushToken';
import { supabase } from '@/supabaseClient';
import BlockedPeople from './blockedPeople';
import BugReport from './bugReport';

// The published documents, opened in a browser rather than bundled into the
// app. One copy on the site is the copy everyone reads — the app store listings
// point at these same URLs — so a correction takes a redeploy instead of a
// release. Trailing slashes are required: the site is a static export.
const PRIVACY_URL = 'https://boolsocial.com/privacy/';
const TERMS_URL = 'https://boolsocial.com/terms/';

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const { session } = useSession();
  const [deleting, setDeleting] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);

  async function handleSignOut() {
    // Before signOut — deleting the row needs the session. Without it this
    // device would keep getting the account's pushes after logging out.
    await unregisterPushToken();
    await supabase.auth.signOut();
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, including any groups you lead. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDelete },
      ]
    );
  }

  async function performDelete() {
    setDeleting(true);
    // Photos first: the storage policies that permit these deletes read the
    // profile and group rows the RPC below is about to remove, so afterwards
    // there would be nothing left to prove the files were ever ours.
    if (session?.user) await deleteMyMedia(session.user.id);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setDeleting(false);
      Alert.alert('Delete failed', error.message);
      return;
    }
    await unregisterPushToken();
    await supabase.auth.signOut();
  }

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.sectionHeader}>Phone</Text>
        <Text style={styles.sectionText}>{session?.user.phone}</Text>

        <Text style={[styles.sectionHeader, styles.legalHeader]}>Safety</Text>
        <TouchableOpacity
          style={[styles.legalRow, styles.legalRowLast]}
          onPress={() => setBlockedOpen(true)}
        >
          <Text style={[styles.sectionText, styles.legalText]}>Blocked</Text>
          <ChevronRight />
        </TouchableOpacity>

        <Text style={[styles.sectionHeader, styles.legalHeader]}>Legal</Text>
        <TouchableOpacity
          style={styles.legalRow}
          onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
        >
          <Text style={[styles.sectionText, styles.legalText]}>Privacy Policy</Text>
          <ChevronRight />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.legalRow, styles.legalRowLast]}
          onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
        >
          <Text style={[styles.sectionText, styles.legalText]}>Terms of Service</Text>
          <ChevronRight />
        </TouchableOpacity>

        <Text style={[styles.sectionHeader, styles.legalHeader]}>Other</Text>
        <TouchableOpacity
          style={[styles.legalRow, styles.legalRowLast]}
          onPress={() => setBugOpen(true)}
        >
          <Text style={[styles.sectionText, styles.legalText]}>Report a Bug</Text>
          <ChevronRight />
        </TouchableOpacity>

        <View style={styles.accountActions}>
          <TouchableOpacity onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteAccount} disabled={deleting} style={styles.deleteButton}>
            {deleting ? (
              <ActivityIndicator color="#e53935" />
            ) : (
              <Text style={styles.deleteText}>Delete Account</Text>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>

      <SlideOver visible={blockedOpen} onRequestClose={() => setBlockedOpen(false)}>
        <BlockedPeople onClose={() => setBlockedOpen(false)} />
      </SlideOver>

      <SlideOver visible={bugOpen} onRequestClose={() => setBugOpen(false)}>
        <BugReport onClose={() => setBugOpen(false)} />
      </SlideOver>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },

  backButton: {
    marginRight: 16,
  },

  title: {
    ...Type.header,
    color: '#000',
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  sectionHeader: {
    ...Type.header,
    color: '#555',
    marginTop: 24,
    marginBottom: 8,
  },

  // The one gap between the two sections, wider than the gap inside either.
  legalHeader: {
    marginTop: 48,
  },

  sectionText: {
    ...Type.body,
    color: '#000',
    marginBottom: 8,
  },

  // Label left, chevron pinned to the right edge of the content — the row is
  // the tap target once the PDFs are wired up. Each row rules off at the top;
  // the last one closes the list at the bottom.
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  legalRowLast: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  // The row's padding owns the spacing now, so drop sectionText's bottom margin
  // — it would push the label off-center between the rules.
  legalText: {
    marginBottom: 0,
  },

  accountActions: {
    alignItems: 'center',
    marginTop: 48,
  },

  signOutText: {
    ...Type.bodyBold,
    color: '#000',
    marginBottom: 20,
  },

  deleteButton: {
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  deleteText: {
    ...Type.bodyBold,
    color: '#e53935',
  },
});
