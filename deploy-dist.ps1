# ============================================================
#  dist プロジェクト（dist-sigma-eight-92.vercel.app）へ
#  現在のコードをデプロイするスクリプト
#
#  使い方（PowerShell）:
#      cd C:\Users\hitomi\shopping-list
#      .\deploy-dist.ps1
#
#  ※ 初回のみ、実行が拒否される場合は次を一度だけ実行してください
#      Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$out = 'dist-deploy'

Write-Host ''
Write-Host '[1/4] 前回のビルドを片付けています...' -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item -Recurse -Force $out }

Write-Host '[2/4] Web版をビルドしています（2〜4分かかります）...' -ForegroundColor Cyan
npx expo export --platform web --output-dir $out
if ($LASTEXITCODE -ne 0) { Write-Host 'ビルドに失敗しました。' -ForegroundColor Red; exit 1 }

Write-Host '[3/4] dist プロジェクトへのリンクを設置しています...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$out\.vercel" | Out-Null
$link = '{"projectId":"prj_06xx7SquNhz79gnsgxnhI59VQnav","orgId":"team_OLUPtq7rBG1Ubwyzt26mNzXb","projectName":"dist"}'
Set-Content -Path "$out\.vercel\project.json" -Value $link -Encoding utf8 -NoNewline

Write-Host '[4/4] Vercel へデプロイしています...' -ForegroundColor Cyan
Push-Location $out
npx vercel --prod
$code = $LASTEXITCODE
Pop-Location

Write-Host ''
if ($code -eq 0) {
  Write-Host '完了しました。' -ForegroundColor Green
  Write-Host 'https://dist-sigma-eight-92.vercel.app/ を開いて確認してください。' -ForegroundColor Green
  Write-Host '（スマホは画面を下に引っぱって再読み込みしてください）' -ForegroundColor DarkGray
} else {
  Write-Host 'デプロイに失敗しました。上のエラーを確認してください。' -ForegroundColor Red
  Write-Host 'トークン切れの場合は  npx vercel login  を実行してから再試行してください。' -ForegroundColor Yellow
}
