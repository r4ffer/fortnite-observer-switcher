# Fortnite Observer Switcher V79

画面共有された映像を画面番号1〜8に対応させ、クリックした画面をそのままPreviewで確認し、「投映」でOBSへ送るシンプル構成です。

## 構成
- 画面共有PC → 対応する画面番号へWebRTCで送信
- 画面番号をクリック → 同じ受信MediaStreamをPreviewに表示
- 投映 → 選択した画面番号だけをOBSが受信
- 投映していない画面はOBSへ接続しない
- 2画面時のみ選択した2本をOBSへ接続
- OBS URL: `/obs-public`
- 認証機構や特定のホスティングサービスに依存しない

## 起動
```bash
npm install
npm start
```

## OBS
Browser Sourceに `https://YOUR-DOMAIN/obs-public` を設定し、1920x1080にします。

## 画面共有
共有するPCごとに `/share?id=1` 〜 `/share?id=8` を開き、対応する画面番号を指定します。

## キー
- 1〜8: 画面選択
- Ctrl + クリック/数字: 2画面選択
- Enter: 投映
- R: 投映解除
- Shift + クリック/数字: 1画面即時投映

## HTTPS
`getDisplayMedia()` を利用するため、実際の画面共有はHTTPSまたはlocalhostで利用してください。
