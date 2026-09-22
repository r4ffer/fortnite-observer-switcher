# Fortnite Observer Switcher

OBS向けの8画面WebRTCスイッチャーです。

## OBS URL
`https://obs.terraearth.xyz/obs.html` に統一しています。

## 映像
- 実映像はWebRTCのみ。静止画サムネイルには切り替えません。
- 共有映像: 1920x1080 / 最大60FPS
- WebRTC送信上限: 12Mbps
- 投映中のOBS接続は選択中の1～2画面のみ

## 起動
```bash
npm install
npm start
```

## 最低動作目安
- Windows 10/11 64bit
- Chrome / Edge 最新版
- CPU: 4コア8スレッド級以上
- RAM: 8GB以上（8画面を同時表示するコントローラーは16GB推奨）
- GPU: WebRTCのハードウェア動画デコード対応GPU推奨
- ネットワーク: 1画面あたり安定した15Mbps以上の上り、コントローラー側は8画面同時なら100Mbps級の受信余裕を推奨
- OBS側: 1920x1080 Browser Sourceを使用

8画面すべてを1080p60で同時表示するため、最低スペックはあくまで起動・動作の目安です。安定運用は16GB RAM、6コア12スレッド級CPU、ハードウェアデコード対応GPUを推奨します。
