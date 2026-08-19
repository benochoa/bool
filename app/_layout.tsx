import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import LoadingScreen from '@/components/ui/loadingScreen';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';

export const unstable_settings = {
  anchor: '(tabs)',
};

// One full loop of the animation. A warm start settles in a fraction of that,
// which would tear the loop off mid-frame — so the screen is held for the whole
// of it whether or not the work below has finished. Drop this to 0 to let it
// run only as long as the loading actually takes.
const MIN_LOADING_MS = 2040;

// Holds the native splash up until the animation has painted; without it the
// splash tears down the moment React mounts, flashing bare white in between.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();
  const [fontsLoaded] = useFonts({
    Manrope_400Regular: require('../assets/fonts/Manrope_400Regular.ttf'),
    Manrope_500Medium: require('../assets/fonts/Manrope_500Medium.ttf'),
    Manrope_600SemiBold: require('../assets/fonts/Manrope_600SemiBold.ttf'),
    Manrope_700Bold: require('../assets/fonts/Manrope_700Bold.ttf'),
  });

  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), MIN_LOADING_MS);
    return () => clearTimeout(timer);
  }, []);

  // Drawn over the app rather than in place of it, so the tree below mounts
  // right away and its fetches — the profile check, the group list, then the
  // feed — run while the animation plays instead of queueing up behind it.
  // The session is part of the condition because the guards below route to
  // login until it lands; the cover hides that flip to (tabs).
  const covered = loading || !fontsLoaded || !minElapsed;

  return (
    <View style={styles.root}>
      <ZoomRoot>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ZoomRoot>
      {covered && <LoadingScreen onShown={SplashScreen.hideAsync} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
