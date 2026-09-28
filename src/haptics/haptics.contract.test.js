const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Android haptics contract', () => {
  it('declares VIBRATE permission when React Native vibration is used', () => {
    const haptics = readSource('src/haptics/haptics.ts');
    const manifest = readSource('android/app/src/main/AndroidManifest.xml');

    expect(haptics).toContain('Vibration.vibrate(');
    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.VIBRATE" />',
    );
  });
});
