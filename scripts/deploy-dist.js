/**
 * dist プロジェクト（https://dist-sigma-eight-92.vercel.app/）へ
 * 現在のコードをデプロイする。
 *
 *   npm run deploy:dist          ビルドからデプロイまで通しで実行
 *   npm run deploy:dist:resume   ビルドを飛ばしてデプロイだけやり直す
 *
 * dist プロジェクトはGit未連携でCLIデプロイ専用なので、
 * ビルド → リンク設置 → vercel --prod をまとめて実行する。
 * リンク（.vercel/project.json）はビルドし直すと消えるため、毎回ここで書き直す。
 *
 * Vercel CLI は「vercel@latest」で毎回最新を指定して呼ぶ。
 * バージョンを固定せず古いCLIを使うと
 * 「Update available for Vercel CLI ... Would you like to upgrade now?」
 * の確認が出て、Windowsでは自己更新が spawn npm ENOENT で失敗し、
 * デプロイまで中断してしまう（実際に発生済み）。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist-deploy');
const LINK =
  '{"projectId":"prj_06xx7SquNhz79gnsgxnhI59VQnav",' +
  '"orgId":"team_OLUPtq7rBG1Ubwyzt26mNzXb","projectName":"dist"}';

// ビルドを飛ばす指定（--skip-build か 環境変数 DEPLOY_DIST_SKIP_BUILD）
const SKIP_BUILD =
  process.argv.includes('--skip-build') || !!process.env.DEPLOY_DIST_SKIP_BUILD;

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: cwd || root, stdio: 'inherit' });
}

try {
  if (SKIP_BUILD) {
    if (!fs.existsSync(path.join(out, 'index.html'))) {
      console.error('dist-deploy にビルド結果がありません。');
      console.error('ビルドから実行してください：  npm run deploy:dist');
      process.exit(1);
    }
    console.log('[1/2] 前回のビルド（dist-deploy）をそのまま使います。');
  } else {
    console.log('[1/4] 前回のビルドを片付けています...');
    fs.rmSync(out, { recursive: true, force: true });

    console.log('[2/4] Web版をビルドしています（2〜4分かかります）...');
    run('npx expo export --platform web --output-dir dist-deploy');
  }

  console.log(`[${SKIP_BUILD ? '2/2' : '3/4'}] dist プロジェクトへのリンクを設置しています...`);
  fs.mkdirSync(path.join(out, '.vercel'), { recursive: true });
  fs.writeFileSync(path.join(out, '.vercel', 'project.json'), LINK);

  if (process.env.DEPLOY_DIST_DRY_RUN) {
    console.log('\nDRY RUN: デプロイ手前で停止しました。');
    process.exit(0);
  }

  console.log(`[${SKIP_BUILD ? '2/2' : '4/4'}] Vercel へデプロイしています...`);
  run('npx --yes vercel@latest --prod --yes', out);

  console.log('\n✅ 完了しました。');
  console.log('https://dist-sigma-eight-92.vercel.app/ を開いて確認してください。');
  console.log('（スマホは画面を下に引っぱって再読み込みしてください）');
} catch (e) {
  console.error('\n❌ 失敗しました。上に出ているエラーを確認してください。');
  console.error('・「token is not valid」→  npx vercel login  を実行してから再試行');
  console.error('・ビルドは終わっていてデプロイだけ失敗した場合は  npm run deploy:dist:resume');
  process.exit(1);
}
