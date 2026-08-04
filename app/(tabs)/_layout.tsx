import { Tabs } from 'expo-router';
import React, { ComponentProps, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { House } from '@/assets/symbols/House';
import { HapticTab } from '@/components/haptic-tab';
import IndividualPost from '@/components/posts/individualPost';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette, Type } from '@/constants/theme';
import { CurrentGroupProvider } from '@/hooks/use-current-group';
import { HideTabBarProvider, useTabBarHidden } from '@/hooks/use-hide-tab-bar';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

// Off-white — pure #fff glares against the bar, so the icons sit just under it.
const TAB_ICON = '#E8E8EA';

// Outline vs filled is the only thing separating the active tab from the rest,
// so every tab draws its symbol identically otherwise.
function TabIcon({ name, color }: { name: ComponentProps<typeof IconSymbol>['name']; color: string }) {
  return <IconSymbol size={25} style={styles.tabIcon} name={name} color={color} />;
}

export default function TabLayout() {
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
        {/* Nothing to view yet, so this one never leaves edit mode — and it
            keeps the ✓, since there's no pencil here to save from. */}
        <IndividualPost
          personId={session.user.id}
          creating
          onSave={() => setComplete(true)}
        />
      </View>
    );
  }

  return (
    <CurrentGroupProvider>
      <HideTabBarProvider>
        <AppTabs />
      </HideTabBarProvider>
    </CurrentGroupProvider>
  );
}

// Split out so it can read the hidden count from the provider above it. The bar
// draws over every screen, so a slide-over panel or an edit screen can only
// cover it by asking for it to go away.
function AppTabs() {
  const tabBarHidden = useTabBarHidden();

  return (
    <Tabs
      screenOptions={{
        // One colour for both states — the active tab is marked by a filled
        // symbol against the others' outlines, not by a tint change.
        tabBarActiveTintColor: TAB_ICON,
        tabBarInactiveTintColor: TAB_ICON,
        headerShown: false,
        tabBarButton: HapticTab,
        // Icons only. Each screen keeps its `title`, which is what the tab
        // still announces to screen readers.
        tabBarShowLabel: false,
        tabBarStyle: tabBarHidden ? { display: 'none' } : undefined,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          // Hand-drawn rather than an SF Symbol — the wrapper matches what
          // TabIcon gives the others, so the row still shares its edges.
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIcon}>
              <House size={25} color={color} filled={focused} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="received"
        options={{
          title: 'Received',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'tray.fill' : 'tray'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'person.3.fill' : 'person.3'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'bubble.left.and.bubble.right.fill' : 'bubble.left.and.bubble.right'}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'person.crop.circle.fill' : 'person.crop.circle'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // IconSymbol draws into a square and scales each symbol to fit it, so the
  // wide ones (person.3, the chat bubbles) hit the width first and come out
  // shorter than the narrow ones. Widening the box past any symbol's aspect
  // leaves height as the only binding side, so all five stand exactly as tall
  // as `size` — same top edge, same bottom edge — and centre horizontally.
  // The margin shifts every icon by the same amount, so the shared edges hold.
  tabIcon: {
    width: 56,
    marginTop: 4,
    // Only bites when this wraps a child (the house) rather than styling the
    // symbol itself.
    alignItems: 'center',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
  },
  gate: {
    flex: 1,
    backgroundColor: Palette.background,
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
