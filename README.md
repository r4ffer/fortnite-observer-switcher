# Fortnite Observer Switcher V78

8画面対応のWebRTCベースOBSスイッチャーです。

## V78の主な変更

- OBSは全共有画面を常時受信せず、現在「投映」している画面だけをWebRTC受信する方式に変更。
- これによりFortniteなど負荷の高い画面で、不要なWebRTCエンコード/デコードを大幅に減らす。
- ControllerのサムネイルとPreviewは同じ受信MediaStreamを利用し、選択時に別の画面取得を行わない。
- OBS側は投映解除すると全WebRTC受信を停止し、次の投映時に必要な画面だけ再接続。
- WebRTC送信設定を高画質寄りに調整。
- `/obs-public`を追加。Basic認証を外側のプロキシで除外できる構成に対応。
- Enter = 投映、R = 投映解除＋Preview黒画面、1～8 = 画面選択、Ctrl = 2画面追加、Shift = 1画面即時投映。
- Ctrl+Shiftでは2画面即時投映を行いません。

## Railway + Basic認証での推奨構成

通常操作:

`https://switcher.example.com/`

→ Basic認証

OBS専用:

`https://obs.example.com/obs-public`

→ Basic認証なし

OBS専用ドメインをスイッチャーサービスへ直接割り当てる場合、`/`も公開される可能性があります。必要ならBasic認証サービスをリバースプロキシとして使い、OBS用パスだけ認証を除外してください。

## 起動

```bash
npm install
npm start
```

## OBS

Browser Sourceに以下を設定します。

```text
https://YOUR-DOMAIN/obs-public
```

Basic認証をOBS URLにかける場合、OBS Browser Sourceが認証画面で止まることがあるため、OBS用URLは認証対象から外してください。

## 注意

このアプリは映像をサーバーでエンコードするのではなく、画面共有PCからController/OBSへWebRTCで直接送信します。ネットワーク環境によってはSTUNだけで接続できない場合があり、その場合はTURNサーバーが必要です。
