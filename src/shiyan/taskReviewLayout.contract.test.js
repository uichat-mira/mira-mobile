const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');
const source = readSource('src/shiyan/ShiyanTaskDetailScreen.tsx');

describe('MOB-032 Shiyan result-first review layout contract', () => {
  it('exposes the organized-result tab and processing summary as separate surfaces', () => {
    const resultIndex = source.indexOf("'整理稿'");
    const processingIndex = source.indexOf('>处理进度</Text>');

    expect(resultIndex).toBeGreaterThan(-1);
    expect(processingIndex).toBeGreaterThan(-1);
    expect(source).toContain("contentTab === 'organized'");
  });

  it('keeps the review-result tab selected and processing details collapsed by default', () => {
    expect(source).toContain(
      "const [contentTab, setContentTab] = useState<'organized' | 'transcript'>('organized');",
    );
    expect(source).toContain(
      "const [processingOpen, setProcessingOpen] = useState(false);",
    );
    expect(source).toContain('{processingOpen ? (');
  });

  it('uses the review-result selector instead of flattening draft semantics in the screen', () => {
    expect(source).toContain('selectShiyanReviewResult(content, candidate)');
    expect(source).toContain('selectShiyanFinalEditorSeed(content, candidate, preferCandidate)');
    expect(source).toContain('用候选继续编辑');
  });

  it('uses the opened editor seed as the dirty baseline and prevents reseeding re-entry', () => {
    expect(source).toContain(
      "const [editorBaselineMarkdown, setEditorBaselineMarkdown] = useState('');",
    );
    expect(source).toContain(
      'finalMarkdown.trim() !== editorBaselineMarkdown.trim()',
    );
    expect(source).toContain('if (finalEditorOpen) return;');
    expect(source).toContain('setEditorBaselineMarkdown(seed.markdown);');
    expect(source).toContain('setEditorBaselineMarkdown(saved);');
    expect(source).toContain('reviewResult && !finalEditorOpen ? (');
  });

  it('protects dirty Final Draft edits before navigation or editor close', () => {
    expect(source).toContain("navigation.addListener('beforeRemove'");
    expect(source).toContain('放弃未保存修改？');
    expect(source).toContain('保存完成后再离开');
  });

  it('refreshes partial result artifacts while an active task is polling', () => {
    const pollStart = source.indexOf('const timer = setInterval(() => {');
    const pollEnd = source.indexOf('}, 5000);', pollStart);
    const pollingSource = source.slice(pollStart, pollEnd);

    expect(pollStart).toBeGreaterThan(-1);
    expect(pollingSource).toContain('void loadTask(true);');
    expect(pollingSource).toContain('void loadTranscript();');
    expect(pollingSource).toContain('void loadContent();');
  });

  it('rejects stale content responses across overlapping refresh and Final Draft save', () => {
    expect(source).toContain('const contentGeneration = useRef(0);');
    expect(source).toContain('const finalSaveInFlight = useRef(false);');
    expect(source).toContain('const generation = ++contentGeneration.current;');
    expect(source).toContain(
      'if (generation !== contentGeneration.current || finalSaveInFlight.current) return;',
    );
    expect(source).toContain('contentGeneration.current += 1;');
  });

  it('keeps transcript as a read-only evidence layer', () => {
    expect(source).toContain("<Text selectable style={[styles.readonlyText");
    expect(source).not.toContain('value={transcript.value.text}');
  });
});
