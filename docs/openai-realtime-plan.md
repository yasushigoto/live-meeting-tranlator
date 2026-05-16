# OpenAI Realtime API 移行メモ

このアプリは、通常モードではブラウザの音声認識で文字起こしし、翻訳だけをサーバーへ送る構成です。`OpenAI Realtime` モードでは、ブラウザからWebRTCで `gpt-realtime-translate` に接続します。

OpenAI Realtime APIで音声入力から翻訳までまとめる場合は、次の構成に移行します。

## 推奨構成

このアプリは2つのAPI接続方式を持ちます。

### サーバー経由

1. ブラウザでマイク、またはBlackHole経由の会議音声を取得する。
2. ブラウザからローカルサーバーへ短命のRealtime Translation client secretを要求する。
3. ローカルサーバーだけが `OPENAI_API_KEY` を使い、client secretを作る。
4. ブラウザはWebRTCで `gpt-realtime-translate` へ音声を送り、データチャネルで翻訳テキストを受け取る。
5. 受け取った翻訳テキストを現在の「翻訳」欄と履歴へ流す。

### ブラウザAPIキー保存

1. GitHub Pagesなどで静的Webアプリを開く。
2. 初回だけOpenAI APIキーをブラウザに保存する。
3. ブラウザがOpenAI APIへ直接アクセスして、Realtime Translation client secretを作る。
4. ブラウザはWebRTCで `gpt-realtime-translate` へ接続する。

この方式は個人端末向けです。APIキーをコードに書いてGitHubへ載せる方式ではありません。

## 使う候補

- Realtime音声翻訳: `gpt-realtime-translate`
- 文字起こし専用: `gpt-4o-transcribe`、`gpt-4o-mini-transcribe`、`gpt-4o-transcribe-latest`
- テキスト翻訳の低コスト運用: Responses API + `gpt-5-mini`

## 公式ドキュメント

- Realtime overview: https://developers.openai.com/api/docs/guides/realtime
- WebRTC connection: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Realtime transcription: https://developers.openai.com/api/docs/guides/realtime-transcription
- Models: https://developers.openai.com/api/docs/models
