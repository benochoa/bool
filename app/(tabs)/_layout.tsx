import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import IndividualPost from '@/components/individualPost';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, FontFamily, Type } from '@/constants/theme';
import { ActiveGroupProvider } from '@/hooks/use-active-group';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { session } = useSession();
  // null = still checking, false = profile incomplete, true = good to go
  const [complete, setComplete] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setComplete(!!data?.name?.trim()));
  }, [session]);

  if (!session) return null;

  if (complete === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!complete) {
    return (
      <View style={styles.gate}>
        <View style={styles.gateHeader}>
          <Text style={styles.gateTitle}>Set up your profile</Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()}>
            <Text style={styles.gateSignOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
        <IndividualPost
          personId={session.user.id}
          editable={true}
          onSave={() => setComplete(true)}
        />
      </View>
    );
  }

  return (
    <ActiveGroupProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: { fontFamily: FontFamily.medium },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Explore',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="flame.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="received"
          options={{
            title: 'Received',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="tray.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="group"
          options={{
            title: 'Group',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.3.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: 'Chats',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="bubble.left.and.bubble.right.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.fill" color={color} />,
          }}
        />
      </Tabs>
    </ActiveGroupProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  gate: {
    flex: 1,
    backgroundColor: '#fff',
  },
  gateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  gateTitle: {
    ...Type.header,
    color: '#000',
  },
  gateSignOut: {
    ...Type.bodyBold,
    color: '#43a047',
  },
});
