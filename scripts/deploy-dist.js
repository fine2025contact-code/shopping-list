/**
 * dist プロジェクト（https://dist-sigma-eight-92.vercel.app/）へ
 * 現在のコードをデプロイする。
 *
 *   npm run deploy:dist
 *
 * dist プロジェクトはGit未連携でCLIデプロイ専用なので、
 * ビルド → リンク設置 → vercel --prod をまとめて実行する。
 * リンク（.vercel/project.json）はビルドし直すと消えるため、毎回ここで書き直す。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist-deploy');
const LINK =
  '{"projectId":"prj_06xx7SquNhz79gnsgxnhI59VQnav",' +
  '"orgId":"team_OLUPtq7rBG1Ubwyzt26mNzXb","projectName":"dist"}';

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: cwd || root, stdio: 'inherit' });
}

try {
  console.log('[1/4] 前回のビルドを片付けています...');
  fs.rmSync(out, { recursive: true, force: true });

  console.log('[2/4] Web版をビルドしています（2〜4分かかります）...');
  run('npx expo export --platform web --output-dir dist-deploy');

  console.log('[3/4] dist プロジェクトへのリンクを設置しています...');
  fs.mkdirSync(path.join(out, '.vercel'), { recursive: true });
  fs.writeFileSync(path.join(out, '.vercel', 'project.json'), LINK);

  if (process.env.DEPLOY_DIST_DRY_RUN) {
    console.log('\nDRY RUN: デプロイ手前で停止しました。');
    process.exit(0);
  }

  console.log('[4/4] Vercel へデプロイしています...');
  run('npx vercel --prod', out);

  console.log('\n✅ 完了しました。');
  console.log('https://dist-sigma-eight-92.vercel.app/ を開いて確認してください。');
  console.log('（スマホは画面を下に引っぱって再読み込みしてください）');
} catch (e) {
  console.error('\n❌ 失敗しました。上に出ているエラーを確認してください。');
  console.error('「token is not valid」と出た場合は  npx vercel login  を実行してから再試行してください。');
  process.exit(1);
}
