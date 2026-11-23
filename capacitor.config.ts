export interface ClimaPayCapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  bundledWebRuntime: boolean;
  server: {
    androidScheme: 'https' | 'http';
    cleartext: boolean;
    allowNavigation: string[];
  };
  android: {
    allowMixedContent: boolean;
    backgroundColor: '#FFFFFF';
  };
  plugins: {
    App: {
      deepLinkScheme: string;
    };
  };
}

const config: ClimaPayCapacitorConfig = {
  appId: 'app.climapay.mobile',
  appName: 'ClimaPay',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: false,
    allowNavigation: ['checkout.wompi.co', '*.vercel.app'],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#FFFFFF',
  },
  plugins: {
    App: {
      deepLinkScheme: 'climapay',
    },
  },
};

export default config;
