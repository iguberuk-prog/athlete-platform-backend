import Constants from "expo-constants";

/** The hosted web app the shell loads. Set in app.json -> expo.extra.appUrl. */
export const APP_URL: string =
  (Constants.expoConfig?.extra as { appUrl?: string } | undefined)?.appUrl ||
  "https://peaceful-paletas-0a1cb4.netlify.app";

export const APP_HOST = new URL(APP_URL).host;
