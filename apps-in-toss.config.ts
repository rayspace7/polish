import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'polish',
  brand: {
    primaryColor: '#4B7358',
  },
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: false,
    transparentBackground: false,
    theme: 'light',
  },
  webBundleDir: 'dist',
});
