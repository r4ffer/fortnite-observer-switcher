# Fortnite Observer Switcher V76

8画面対応のWebRTCベースOBSスイッチャーです。

## V76の主な変更

- 共有画面がWebRTC上で「接続済みなのに映像が止まる/黒くなる」ケース向けのデコーダー監視を追加。
- Controller Preview / OBSの両方で、映像フレームが一定時間止まった場合だけ自動再接続。
- 再接続時にOBS側の現在の映像要素を即座に黒画面へ戻さず、復旧後に新しい接続を表示するよう改善。
- 画面共有側の映像設定を1080p/60FPS優先にし、ゲーム画面向けに`contentHint=motion`を使用。
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
