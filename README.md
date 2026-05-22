# Live Meeting Translator

会議音声をリアルタイムに文字起こしして翻訳するWebアプリです。

## 使い方

1. ページを開く
2. `API接続方式` で `ブラウザにAPIキーを保存` を選ぶ
3. OpenAI APIキーを入力して `保存`
4. 音声入力を選ぶ
5. `開始` を押す

APIキーは自分のブラウザ内に保存されます。GitHubには保存されません。

## GitHub Pagesで使う場合

GitHub Pagesなどサーバーなしで開いた場合は、自動で `ブラウザにAPIキーを保存` 方式になります。

## Macで会議音声を拾う場合

Zoom、Google Meet、Teamsなどの相手側音声を拾うには、BlackHoleなどの仮想オーディオを使います。

このアプリ側では、`音源入力` から `BlackHole 2ch` または作成したAggregate Deviceを選びます。

## ローカルで起動する場合

```bash
/Applications/Codex.app/Contents/Resources/node server.js
```

そのあと `http://localhost:4173/` を開きます。
