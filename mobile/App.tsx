/**
 * Athlete Performance: iPhone app shell.
 *
 * Loads the hosted web app in a WebView and adds what only a native app can do:
 *   - Reminders as real iPhone notifications (scheduled locally, work offline)
 *   - Apple Health read for sleep, resting heart rate and HRV on check-in
 *   - Tapping a reminder opens the right screen
 *   - Offline screen with retry, safe-area layout, haptics, external links in Safari
 *
 * Bridge protocol (see public/js/native.js in the web app):
 *   web -> native: { type: "reminders" | "health:request" | "signout" }
 *   native -> web: window.__native({ type: "ready" | "health", ... })
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { APP_HOST, APP_URL } from "./src/config";
import { clearReminders, scheduleReminders, type Reminder } from "./src/notifications";
import { healthAvailable, readLastNight } from "./src/health";

SplashScreen.preventAutoHideAsync().catch(() => {});

const BG = "#0b0e12";
const LIME = "#bff63f";

type WebMsg =
  | { type: "reminders"; items: Reminder[]; name?: string }
  | { type: "health:request" }
  | { type: "signout" }
  | { type: "haptic" };

export default function App() {
  const web = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  const send = useCallback((msg: object) => {
    web.current?.injectJavaScript(`window.__native && window.__native(${JSON.stringify(msg)}); true;`);
  }, []);

  const goTo = useCallback((hash: string) => {
    web.current?.injectJavaScript(`location.hash = ${JSON.stringify(hash)}; true;`);
  }, []);

  // Tapping a reminder opens the matching screen (also on cold start).
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const route = lastResponse?.notification.request.content.data?.route;
    if (typeof route === "string") setPendingRoute(route);
  }, [lastResponse]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: WebMsg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    switch (msg.type) {
      case "reminders":
        await scheduleReminders(msg.items || [], msg.name).catch(() => 0);
        break;
      case "health:request": {
        const snap = await readLastNight().catch(() => null);
        send({ type: "health", ...(snap || {}) });
        break;
      }
      case "signout":
        await clearReminders().catch(() => {});
        break;
      case "haptic":
        Haptics.selectionAsync().catch(() => {});
        break;
    }
  }, [send]);

  const onLoadEnd = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
    send({ type: "ready", platform: "ios", version: Constants.expoConfig?.version, health: healthAvailable() });
    if (pendingRoute) { goTo(pendingRoute); setPendingRoute(null); }
  }, [send, goTo, pendingRoute]);

  useEffect(() => {
    if (pendingRoute) { goTo(pendingRoute); setPendingRoute(null); }
  }, [pendingRoute, goTo]);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        {failed ? (
          <SafeAreaView style={styles.offline}>
            <Text style={styles.h1}>You're offline</Text>
            <Text style={styles.p}>Connect to Wi-Fi or cellular, then try again. Your reminders still arrive while you're offline.</Text>
            <Pressable style={styles.btn} onPress={() => { setFailed(false); setKey((k) => k + 1); }}>
              <Text style={styles.btnText}>Try again</Text>
            </Pressable>
          </SafeAreaView>
        ) : (
          <WebView
            key={key}
            ref={web}
            source={{ uri: `${APP_URL}/#/today` }}
            style={styles.web}
            originWhitelist={["https://*"]}
            onMessage={onMessage}
            onLoadEnd={onLoadEnd}
            onError={() => setFailed(true)}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
            onShouldStartLoadWithRequest={(req) => {
              // Our site stays in the app; everything else (email links, Google Calendar) opens outside.
              try {
                const u = new URL(req.url);
                if (u.host === APP_HOST || u.protocol === "about:" || u.protocol === "blob:" || u.protocol === "data:") return true;
                Linking.openURL(req.url).catch(() => {});
                return false;
              } catch { return true; }
            }}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            sharedCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            contentInsetAdjustmentBehavior="never"
            decelerationRate="normal"
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}><ActivityIndicator color={LIME} /></View>
            )}
            applicationNameForUserAgent="AthletePerformanceApp/1.0"
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  offline: { flex: 1, backgroundColor: BG, padding: 24, justifyContent: "center" },
  h1: { color: "#eef3f8", fontSize: 26, fontWeight: "900", marginBottom: 10 },
  p: { color: "#98a6b6", fontSize: 16, lineHeight: 23, marginBottom: 24 },
  btn: { backgroundColor: LIME, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnText: { color: BG, fontWeight: "800", fontSize: 16 },
});
