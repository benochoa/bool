import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

export default function HomeScreen() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setName(data?.name ?? '');
        setLoading(false);
      });
  }, [session]);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{name || 'Your account'}</Text>
      <Text style={styles.phone}>{session?.user.phone}</Text>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 100,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
  },
  phone: {
    fontSize: 16,
    color: '#555',
    marginTop: 8,
  },
  signOutButton: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
});