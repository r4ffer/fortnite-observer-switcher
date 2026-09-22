# Fortnite Observer Switcher V84

8画面対応のOBS用Webスイッチャーです。

## OBS接続URL

**必ず次のURLだけを使用します。**

`https://obs.terraearth.xyz/obs.html`

`/obs-public` は使用しません。

## 画質

実際のWebRTC映像は **1920×1080 / 60FPS / 高画質** を維持します。
共有トラックに対して低画質・15FPSへ切り替える処理はありません。

サイトが重くならないよう、画面1～8の一覧はWebRTC映像を8本同時デコードせず、共有側から軽量なサムネイル画像を受信します。
選択した画面だけが実際の1080p60 WebRTC映像になり、PreviewとOBSはその高画質映像を使用します。

## 起動

```bash
npm install
npm start
```

## 共有URL

- `/share.html?id=1`
- `/share.html?id=2`
- …
- `/share.html?id=8`

画面共有はブラウザの仕様上HTTPS環境で使用してください。

## OBS

OBSでブラウザソースを追加し、URLに上記 `/obs.html` を設定します。
幅1920、高さ1080を推奨します。

## 操作

- 通常クリック / 画面キー: 1画面選択
- Ctrl + クリック / 画面キー: 2画面目を追加
- Shift + クリック / 画面キー: 1画面を即時投映
- Enter: 投映
- R: 投映解除 + Previewを黒画面

## テスト

```bash
npm test
```

構文、HTML参照、OBS URL、低画質WebRTC設定の混入、サムネイル経路、WebRTC停止処理などを自動確認します。
