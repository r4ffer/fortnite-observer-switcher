# Fortnite Observer Switcher V80

WebRTCベースのFortnite観戦用スイッチャーです。

## V80の修正
- Controllerの画面番号サムネイルとPreviewで、WebRTCが渡した元のMediaStreamを直接使用するよう修正
- `ontrack` 後に新しいMediaStreamを作り直す方式を廃止
- Chromiumで「OBSには映るがControllerのサムネイル/Previewだけ黒い」ケースを修正
- OBSは投映中の画面だけWebRTC接続
- OBS URL: `/obs-public`

## 起動
```bash
npm install
npm start
```

## OBS
Browser Source URL:
`https://obs.terraearth.xyz/obs-public`

## GitHub
このZIPの中身をリポジトリ直下へ配置してください。
