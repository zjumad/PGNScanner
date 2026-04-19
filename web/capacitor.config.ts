import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pgnscanner.app',
  appName: 'PGN Scanner',
  webDir: 'dist',
  server: {
    // Allow external API calls from the WebView
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
