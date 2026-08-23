import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Cloudflare Turnstile, which Supabase requires a token from before it will
// send an OTP. There is no native SDK, so the widget runs in a WebView that
// draws nothing: invisible mode issues a token with no UI at all, which is the
// only workable shape here — a challenge the user must tap would sit inside a
// view nobody can see.
//
// baseUrl has to match a hostname registered on the widget in the Cloudflare
// dashboard ('localhost'), because Turnstile checks the origin the widget ran
// on and rejects a token minted anywhere else.
const SITE_KEY = '0x4AAAAAAEZeDCEV_9SuegKd';
const BASE_URL = 'https://localhost';

// A token is single-use and short-lived, so it's minted per send rather than
// held: getToken() resets the widget and runs it again every time.
const TOKEN_TIMEOUT_MS = 20000;

export interface TurnstileHandle {
  // Resolves with a fresh token, or null if the widget failed or timed out.
  getToken: () => Promise<string | null>;
}

// `execution: 'execute'` keeps the widget idle until asked, so no token is
// minted (and left to expire) just because the login screen opened.
const HTML = `<!DOCTYPE html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body>
    <div id="widget"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoad&render=explicit"></script>
    <script>
      var widgetId = null;
      function post(message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
      function onLoad() {
        widgetId = turnstile.render('#widget', {
          sitekey: '${SITE_KEY}',
          execution: 'execute',
          callback: function (token) { post({ type: 'token', token: token }); },
          'error-callback': function (code) { post({ type: 'error', code: String(code) }); },
          'timeout-callback': function () { post({ type: 'error', code: 'timeout' }); },
        });
      }
      window.runTurnstile = function () {
        if (widgetId === null) { post({ type: 'error', code: 'not-ready' }); return; }
        turnstile.reset(widgetId);
        turnstile.execute(widgetId);
      };
    </script>
  </body>
</html>`;

function TurnstileComponent(_props: object, ref: React.Ref<TurnstileHandle>) {
  const webRef = useRef<WebView>(null);
  // The caller waiting on the current token, cleared as soon as it's settled so
  // a late second message can't resolve a promise that already finished.
  const pending = useRef<((token: string | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback((token: string | null) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const resolve = pending.current;
    pending.current = null;
    resolve?.(token);
  }, []);

  useImperativeHandle(ref, () => ({
    getToken: () =>
      new Promise<string | null>(resolve => {
        // A second request while one is in flight abandons the first, so its
        // caller isn't left hanging on a token that will never be delivered.
        settle(null);
        pending.current = resolve;
        // Turnstile can hang on a bad network; without this the login button
        // would spin forever rather than failing with something readable.
        timer.current = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
        webRef.current?.injectJavaScript('window.runTurnstile(); true;');
      }),
  }), [settle]);

  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        ref={webRef}
        source={{ html: HTML, baseUrl: BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        // Android won't run the widget's script from a data-ish source without
        // this; on iOS it's a no-op.
        domStorageEnabled
        onMessage={event => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type === 'token') settle(message.token);
            else if (message.type === 'error') {
              console.log('[turnstile]', message.code);
              settle(null);
            }
          } catch {
            settle(null);
          }
        }}
        onError={() => settle(null)}
      />
    </View>
  );
}

export default forwardRef<TurnstileHandle, object>(TurnstileComponent);

const styles = StyleSheet.create({
  // Mounted but out of the way. A zero-sized WebView doesn't reliably run its
  // script on Android, so it keeps a pixel and loses its visibility instead.
  host: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
  },
});