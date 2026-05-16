# Live Meeting Translator

Macのブラウザで動く、会議向けのリアルタイム文字起こし・翻訳アプリです。

## 使い方

1. `node server.js` でローカルサーバーを起動します。
2. `http://localhost:4173` をChromeまたはSafariで開きます。
3. 音声言語と翻訳先を選びます。
4. `開始` を押してマイク利用を許可します。

標準の `ローカル翻訳` は、ローカルサーバーが翻訳サービスへ中継します。OpenAIを使う場合は `.env.example` を参考に `.env` を作り、`OPENAI_API_KEY` を設定してから翻訳エンジンで `OpenAI API` を選んでください。

翻訳前に `文脈補正` 欄で文字起こしを整えます。`OPENAI_API_KEY` がある場合はOpenAI APIで補正し、ない場合は基本的な空白・句読点の整形だけを行います。

`OPENAI_API_KEY` がある場合は、直近の文を約15秒ごとに前後の文脈から再補正し、必要に応じて補正文と訳文を更新します。キーがない場合は即時補正だけで動きます。

`OpenAI Realtime` モードでは、サーバーが短命のRealtime Translation client secretを作り、ブラウザがWebRTCで `gpt-realtime-translate` に接続します。APIキーはブラウザへ渡しません。

GitHub Pagesなどサーバーなしで使う場合は、画面の `API接続方式` を `ブラウザにAPIキーを保存` に変更し、初回だけOpenAI APIキーを入力してください。この場合はブラウザ内にキーを保存してOpenAIへ直接接続します。個人利用向けの方式です。

ブラウザ内蔵翻訳は実験機能のため、通常は `ローカル翻訳` または `OpenAI API` を使ってください。

## Macで会議音声を拾う場合

マイク入力はそのまま使えます。Zoom、Google Meet、Teamsなどの相手側音声も拾う場合は、BlackHoleなどの仮想オーディオデバイスで会議音声を入力へ回す必要があります。

## ファイル

- `index.html`: 画面
- `styles.css`: 見た目
- `app.js`: 音声認識、翻訳、履歴保存
- `server.js`: 画面配信と翻訳中継
