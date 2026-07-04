import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import IndividualPost from '@/components/individualPost';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

export default function HomeScreen() {
  const { session } = useSession();

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (!session) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.phone}>{session.user.phone}</Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <IndividualPost personId={session.user.id} editable={true} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  phone: {
    fontSize: 16,
    color: '#555',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
});
