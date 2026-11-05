import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xaviel.xmoney',
  appName: 'X Money',
  webDir: 'dist/x-money/browser',
  backgroundColor: '#121212',
  // The debug build of Capacitor prints every plugin call to the system log, session tokens included: keep it silent
  loggingBehavior: 'none',
};

export default config;
