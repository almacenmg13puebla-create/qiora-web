import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qiora.almacen',
  appName: 'QIORA',
  webDir: 'www',
  server: {
    url: 'https://sistematraspasos.com',
    cleartext: false,
    allowNavigation: [
      'sistematraspasos.com',
      'www.sistematraspasos.com'
    ]
  }
};

export default config;
