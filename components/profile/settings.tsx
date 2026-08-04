import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const { session } = useSession();
  const [deleting, setDeleting] = useState(false);

  async function handleSignOut() {
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
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setDeleting(false);
      Alert.alert('Delete failed', error.message);
      return;
    }
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

        <Text style={styles.sectionHeader}>Legal</Text>
        <Text style={styles.sectionText}>Privacy Policy</Text>
        <Text style={styles.sectionText}>Terms of Service</Text>

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
    ...Type.label,
    color: '#555',
    marginTop: 24,
    marginBottom: 8,
  },

  sectionText: {
    ...Type.body,
    color: '#000',
    marginBottom: 8,
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
