const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(
  resolve(process.cwd(), 'src/shiyan/UnifiedRecordRow.tsx'),
  'utf8',
);

describe('Shiyan unified record row layout contract', () => {
  it('centers status against the whole record row instead of the title line', () => {
    const mainStart = source.indexOf('<View style={styles.main}>');
    const mainEnd = source.indexOf('</View>', mainStart);
    const status = source.indexOf('<Text style={[styles.status');

    expect(mainStart).toBeGreaterThan(-1);
    expect(mainEnd).toBeGreaterThan(mainStart);
    expect(status).toBeGreaterThan(mainEnd);
    expect(source).toContain("alignItems: 'center'");
    expect(source).not.toContain('styles.titleRow');
  });
});
