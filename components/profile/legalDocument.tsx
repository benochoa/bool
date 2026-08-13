import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import * as WebBrowser from 'expo-web-browser';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';

interface Props {
  title: string;
  // A body fragment (<h1>, <p>, …), not a whole document — the page around it
  // is this component's job.
  html: string;
  onClose: () => void;
}

// The legal documents are authored as HTML and shipped as HTML, so they're
// rendered by a WebView rather than retyped as Text: a policy is long, mostly
// prose, and gains nothing from being turned into React Native components.
// Manrope isn't available inside the WebView, so the page asks for the
// platform's own UI font — the one system text is already set in.
function page(fragment: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    margin: 0;
    padding: 0 20px 40px;
    background: ${Palette.background};
    color: #000;
    font-family: -apple-system, system-ui, Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    -webkit-text-size-adjust: 100%;
  }
  h1 { font-size: 24px; margin: 8px 0 4px; }
  h2 { font-size: 19px; margin-top: 32px; }
  h3 { font-size: 17px; margin-top: 24px; }
  h4 { font-size: 16px; margin-top: 20px; }
  li { margin-bottom: 8px; }
  a { color: ${Palette.confirm}; }
</style>
</head>
<body>${fragment}</body>
</html>`;
}

export default function LegalDocument({ title, html, onClose }: Props) {
  // The document arrives as markup rather than as a URL, so its own load is
  // about:blank; a real address means someone tapped a link in the text. Those
  // go to the system browser — followed in here, they'd replace the policy with
  // a page this panel has no way to come back from.
  function handleRequest(request: ShouldStartLoadRequest) {
    if (!/^https?:/i.test(request.url)) return true;
    WebBrowser.openBrowserAsync(request.url);
    return false;
  }

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
      </View>

      <WebView
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: page(html) }}
        onShouldStartLoadWithRequest={handleRequest}
      />

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

  web: {
    flex: 1,
    backgroundColor: Palette.background,
  },
});
