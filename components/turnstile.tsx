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

// A token is minted ahead of time and held, so tapping Send doesn't wait on
// Cloudflare before it can even start waiting on Twilio. Turnstile's own
// tokens last around five minutes; this expires them earlier so a held one is
// never close to the edge when it's finally used.
const TOKEN_TTL_MS = 3 * 60 * 1000;
// How long a caller waits when there's nothing held — a cold screen, or a
// second send inside the same minute.
const TOKEN_TIMEOUT_MS = 20000;

export interface TurnstileHandle {
  // Resolves with a token, or null if the widget failed or timed out. Usually
  // instant: the answer is already in hand by the time anyone taps.
  getToken: () => Promise<string | null>;
}

// `execution: 'execute'` keeps the widget from running on render, so minting is
// something this component decides to do rather than a side effect of the page
// loading. It runs one immediately anyway — the point is to control *when*.
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
        window.runTurnstile();
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
  // The token waiting to be spent, and when it was issued.
  const held = useRef<{ token: string; at: number } | null>(null);
  // Callers waiting because nothing was held when they asked.
  const waiting = useRef<((token: string | null) => void)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mint = useCallback(() => {
    webRef.current?.injectJavaScript('window.runTurnstile(); true;');
  }, []);

  // Hands the result to everyone queued and empties the queue — a token that
  // arrives with nobody waiting is simply held for the next caller instead.
  const settle = useCallback((token: string | null) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const queued = waiting.current;
    waiting.current = [];
    queued.forEach(resolve => resolve(token));
    return queued.length > 0;
  }, []);

  useImperativeHandle(ref, () => ({
    getToken: () => {
      const current = held.current;
      if (current && Date.now() - current.at < TOKEN_TTL_MS) {
        // Spent on the way out: a token works once, so the next caller needs a
        // different one and the widget should start on it now rather than when
        // they ask.
        held.current = null;
        mint();
        return Promise.resolve(current.token);
      }
      held.current = null;
      return new Promise<string | null>(resolve => {
        waiting.current.push(resolve);
        if (!timer.current) {
          timer.current = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
        }
        mint();
      });
    },
  }), [mint, settle]);

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
            if (message.type === 'token') {
              // Nobody waiting means this was the pre-minted one: keep it.
              if (!settle(message.token)) held.current = { token: message.token, at: Date.now() };
            } else if (message.type === 'error') {
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