import { DarkTheme } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import React, { ComponentProps, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { House } from '@/assets/symbols/House';
import { HapticTab } from '@/components/haptic-tab';
import IndividualPost from '@/components/posts/individualPost';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette, Type } from '@/constants/theme';
import { BlockedPeopleProvider } from '@/hooks/use-blocked-people';
import { CurrentGroupProvider } from '@/hooks/use-current-group';
import { HideTabBarProvider, useTabBarHidden } from '@/hooks/use-hide-tab-bar';
import { useSession } from '@/hooks/use-session';
import { TabBadgeProvider, useTabBadges } from '@/hooks/use-tab-badges';
import { supabase } from '@/supabaseClient';

// Off-white — pure #fff glares against the bar, so the icons sit just under it.
const TAB_ICON = '#E8E8EA';
// Shared by the SF Symbols and the hand-drawn house, so the row can't end up
// with one icon a different size from the rest.
const TAB_ICON_SIZE = 22;
// Same symbols, heavier strokes. The house is an SVG rather than a symbol, so
// it carries the weight in its own stroke width instead — the two are matched
// by eye, not by a shared number.
const TAB_ICON_WEIGHT = 'semibold';
const TAB_HOUSE_STROKE = 2.8;

// Outline vs filled is the only thing separating the active tab from the rest,
// so every tab draws its symbol identically otherwise.
function TabIcon({ name, color }: { name: ComponentProps<typeof IconSymbol>['name']; color: string }) {
  return <IconSymbol size={TAB_ICON_SIZE} style={styles.tabIcon} name={name} color={color} weight={TAB_ICON_WEIGHT} />;
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
      <BlockedPeopleProvider>
        <TabBadgeProvider>
          <HideTabBarProvider>
            <AppTabs />
          </HideTabBarProvider>
        </TabBadgeProvider>
      </BlockedPeopleProvider>
    </CurrentGroupProvider>
  );
}

// Split out so it can read the hidden count from the provider above it. The bar
// draws over every screen, so a slide-over panel or an edit screen can only
// cover it by asking for it to go away.
function AppTabs() {
  const tabBarHidden = useTabBarHidden();
  const { pending, received, unread } = useTabBadges();

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
        tabBarStyle: tabBarHidden ? { display: 'none' } : styles.tabBar,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          // Empty string, not the count: this one only says "something's
          // waiting" — the number itself lives on the Pending sub-tab inside
          // the screen. Undefined still means no badge at all.
          tabBarBadge: pending > 0 ? '' : undefined,
          tabBarBadgeStyle: styles.tabDot,
          // Hand-drawn rather than an SF Symbol — the wrapper matches what
          // TabIcon gives the others, so the row still shares its edges.
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIcon}>
              <House size={TAB_ICON_SIZE} color={color} filled={focused} strokeWidth={TAB_HOUSE_STROKE} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="received"
        options={{
          title: 'Received',
          tabBarBadge: received > 0 ? received : undefined,
          tabBarBadgeStyle: styles.tabBadge,
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
          // A dot like Explore's: the bolded rows in the list are where the
          // count actually lives.
          tabBarBadge: unread > 0 ? '' : undefined,
          tabBarBadgeStyle: styles.tabDot,
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
  // Dark whatever the system scheme is, rather than following it — taken from
  // React Navigation's own dark theme so it is that bar, not an approximation
  // of it. The off-white icons above were only ever cut for this background.
  tabBar: {
    backgroundColor: DarkTheme.colors.card,
    borderTopColor: DarkTheme.colors.border,
  },

  // IconSymbol draws into a square and scales each symbol to fit it, so the
  // wide ones (person.3, the chat bubbles) hit the width first and come out
  // shorter than the narrow ones. Widening the box past any symbol's aspect
  // leaves height as the only binding side, so all five stand exactly as tall
  // as `size` — same top edge, same bottom edge — and centre horizontally.
  // The margin shifts every icon by the same amount, so the shared edges hold.
  // Red circle, white number. Stated rather than inherited: the bar is styled
  // from the dark theme but the navigator itself is on the light one, so the
  // default badge colour would come from the wrong palette.
  //
  // The bar positions its badge at the icon's top-right (`end: -3, top: -3`);
  // this moves it to the bottom-right. `top` has to be cleared rather than
  // just adding `bottom`, since a badge with both edges set and a height of
  // its own would stay pinned to the top one.
  // Height, width and radius move together — the badge is a Text, so it's only
  // a circle while all three agree.
  tabBadge: {
    backgroundColor: '#FF3B30',
    color: '#fff',
    fontSize: 10,
    lineHeight: 15,
    height: 16,
    minWidth: 16,
    borderRadius: 8,
    top: undefined,
    bottom: -4,
    end: -4,
  },

  // The same badge with nothing in it — smaller, and no horizontal padding to
  // stretch it out of round. Sits tighter to the icon than the numbered ones
  // so a dot this size still reads as attached to it.
  tabDot: {
    backgroundColor: '#FF3B30',
    height: 10,
    minWidth: 10,
    lineHeight: 10,
    borderRadius: 5,
    paddingHorizontal: 0,
    top: undefined,
    bottom: -2,
    end: -2,
  },

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
