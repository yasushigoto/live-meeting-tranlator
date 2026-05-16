const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SILENCE_DELAY_MS = 1800;
const SENTENCE_END_DELAY_MS = 450;
const MAX_BUFFER_MS = 15000;
const CONTEXT_REVISE_MS = 15000;
const CONTEXT_SEGMENT_LIMIT = 6;

const elements = {
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  translateInputBtn: document.querySelector("#translateInputBtn"),
  sourceLang: document.querySelector("#sourceLang"),
  targetLang: document.querySelector("#targetLang"),
  translatorMode: document.querySelector("#translatorMode"),
  apiMode: document.querySelector("#apiMode"),
  apiSettings: document.querySelector("#apiSettings"),
  browserKeyField: document.querySelector("#browserKeyField"),
  browserApiKey: document.querySelector("#browserApiKey"),
  browserKeyActions: document.querySelector("#browserKeyActions"),
  saveBrowserKeyBtn: document.querySelector("#saveBrowserKeyBtn"),
  clearBrowserKeyBtn: document.querySelector("#clearBrowserKeyBtn"),
  libreSettings: document.querySelector("#libreSettings"),
  libreEndpoint: document.querySelector("#libreEndpoint"),
  libreKey: document.querySelector("#libreKey"),
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  sourceBadge: document.querySelector("#sourceBadge"),
  targetBadge: document.querySelector("#targetBadge"),
  transcriptText: document.querySelector("#transcriptText"),
  refinedText: document.querySelector("#refinedText"),
  translationText: document.querySelector("#translationText"),
  interimText: document.querySelector("#interimText"),
  refineHint: document.querySelector("#refineHint"),
  translationHint: document.querySelector("#translationHint"),
  historyList: document.querySelector("#historyList"),
  copyTranscriptBtn: document.querySelector("#copyTranscriptBtn"),
  copyRefinedBtn: document.querySelector("#copyRefinedBtn"),
  copyTranslationBtn: document.querySelector("#copyTranslationBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  itemTemplate: document.querySelector("#historyItemTemplate"),
};

const state = {
  recognition: null,
  listening: false,
  manualStop: false,
  transcript: [],
  refined: [],
  translations: [],
  segments: [],
  pendingTranscript: [],
  pendingStartedAt: 0,
  flushTimer: null,
  contextTimer: null,
  realtime: null,
  realtimeSourceBuffer: "",
  realtimeTranslationBuffer: "",
  realtimeHistoryTimer: null,
  processingQueue: Promise.resolve(),
  translator: null,
  translatorKey: "",
};

const storageKey = "live-meeting-translator-settings";
const browserApiKeyStorageKey = "live-meeting-translator-openai-key";

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  for (const [key, value] of Object.entries(saved)) {
    if (elements[key] && typeof value === "string") {
      elements[key].value = value;
    }
  }
  if (!saved.translatorMode || saved.translatorMode === "browser") {
    elements.translatorMode.value = "realtime";
  }
  elements.browserApiKey.value = localStorage.getItem(browserApiKeyStorageKey) || "";
  toggleLibreSettings();
  toggleApiSettings();
  updateBadges();
}

function isRealtimeMode() {
  return elements.translatorMode.value === "realtime";
}

function saveSettings() {
  const settings = {
    sourceLang: elements.sourceLang.value,
    targetLang: elements.targetLang.value,
    translatorMode: elements.translatorMode.value,
    apiMode: elements.apiMode.value,
    libreEndpoint: elements.libreEndpoint.value,
    libreKey: elements.libreKey.value,
  };
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

function updateStatus(label, active = false) {
  elements.statusText.textContent = label;
  elements.statusPill.classList.toggle("active", active);
}

function updateBadges() {
  elements.sourceBadge.textContent = elements.sourceLang.value;
  elements.targetBadge.textContent = elements.targetLang.value;
}

function toggleLibreSettings() {
  elements.libreSettings.hidden = elements.translatorMode.value !== "libre";
}

function usesOpenAI() {
  return elements.translatorMode.value === "realtime" || elements.translatorMode.value === "openai";
}

function useBrowserApiKey() {
  return usesOpenAI() && elements.apiMode.value === "browser";
}

function toggleApiSettings() {
  elements.apiSettings.hidden = !usesOpenAI();
  const showBrowserKey = useBrowserApiKey();
  elements.browserKeyField.hidden = !showBrowserKey;
  elements.browserKeyActions.hidden = !showBrowserKey;
}

function getBrowserApiKey() {
  return elements.browserApiKey.value.trim() || localStorage.getItem(browserApiKeyStorageKey) || "";
}

function saveBrowserApiKey() {
  const key = elements.browserApiKey.value.trim();
  if (!key) {
    elements.translationHint.textContent = "保存するOpenAI API Keyを入力してください。";
    return;
  }
  localStorage.setItem(browserApiKeyStorageKey, key);
  elements.browserApiKey.value = key;
  updateStatus("APIキー保存済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

function clearBrowserApiKey() {
  localStorage.removeItem(browserApiKeyStorageKey);
  elements.browserApiKey.value = "";
  updateStatus("APIキー削除済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

function appendLiveText(target, text) {
  if (!text) return;
  target.value = target.value ? `${target.value}\n\n${text}` : text;
  target.scrollTop = target.scrollHeight;
}

function replaceLiveText(target, lines) {
  target.value = lines.filter(Boolean).join("\n\n");
  target.scrollTop = target.scrollHeight;
}

function renderHistoryItem(segment) {
  const fragment = elements.itemTemplate.content.cloneNode(true);
  fragment.querySelector("time").textContent = segment.time;
  fragment.querySelector(".refined span").textContent = segment.refined || "";
  fragment.querySelector(".translation span").textContent = segment.translation || "翻訳なし";
  elements.historyList.prepend(fragment);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  for (const segment of [...state.segments].reverse()) {
    renderHistoryItem(segment);
  }
}

function appendRealtimeDelta(target, text) {
  if (!text) return;
  target.value += text;
  target.scrollTop = target.scrollHeight;
}

function getLangRoot(lang) {
  return lang.split("-")[0];
}

function basicRefineText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\b(um|uh|er|ah)\b/gi, "")
    .replace(/(^|\s)(えっと|えーと|あの|その|まあ)(\s|、|,)/g, "$1")
    .replace(/([\u3040-\u30ff\u3400-\u9fff])\s+([\u3040-\u30ff\u3400-\u9fff])/g, "$1$2")
    .replace(/\s+([、。，．,.!?！？])/g, "$1")
    .trim();
}

function looksLikeSentenceEnd(text) {
  const normalized = basicRefineText(text);
  if (/[。．.!?！？]$/.test(normalized)) return true;

  const incompleteJapaneseEndings = /(ですが|ますが|ですけど|ますけど|だけど|なので|から|ので|ため|として|について|では|なら|また|そして|えっと|えーと|あの)$/;
  if (incompleteJapaneseEndings.test(normalized)) return false;

  const completeJapaneseEndings =
    /(です|でした|ます|ました|ません|ください|だと思います|と思います|になります|あります|ありません|します|しました|できます|できました|いきます|行きます|終わります|始めます|確認します|共有します|お願いします|でしょう|ですよね|ですね|ですか|ますか)$/;
  if (completeJapaneseEndings.test(normalized)) return true;

  const incompleteEnglishEndings =
    /\b(and|or|but|so|because|if|when|while|although|though|unless|until|to|for|with|about|regarding|between|from|that|which|who|where|then|also|actually|basically|maybe|probably|we|i|you|they|it|the|a|an|of|in|on|at|by)$/i;
  if (incompleteEnglishEndings.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  const completeEnglishEndings =
    /\b(am|is|are|was|were|be|been|being|do|does|did|done|have|has|had|can|could|should|would|will|won't|can't|need|needs|needed|want|wants|wanted|think|thinks|thought|know|knows|knew|agree|agrees|agreed|finish|finished|start|started|confirm|confirmed|share|shared|review|reviewed|approve|approved|decide|decided|discuss|discussed|ship|shipped|launch|launched|go|goes|went|going|ok|okay|right|today|tomorrow|next|later|now|budget|schedule|timeline|deadline|document|proposal|contract|issue|risk|decision|question|meeting|project|customer|client|team|plan|status|update|action|owner|owners|task|tasks)\.?$/i;
  return completeEnglishEndings.test(normalized);
}

function parseOpenAIOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
      .trim() || ""
  );
}

async function fetchOpenAITextTask(systemPrompt, userText) {
  const key = getBrowserApiKey();
  if (!key) throw new Error("OpenAI API Keyを入力してください。");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  return parseOpenAIOutputText(data);
}

async function refineText(text) {
  const source = getLangRoot(elements.sourceLang.value);
  if (useBrowserApiKey()) {
    return fetchOpenAITextTask(
      [
        `You clean up live meeting transcripts in ${source}.`,
        "Fix obvious speech recognition errors, punctuation, casing, spacing, and duplicated filler.",
        "Preserve meaning, speaker intent, names, numbers, and technical terms.",
        "Do not summarize. Return only the corrected text.",
      ].join(" "),
      text,
    );
  }

  const response = await fetch("/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `文脈補正エラー: ${response.status}`);
  }

  const data = await response.json();
  return data.refinedText || basicRefineText(text);
}

async function reviseContextSegments(segments) {
  const source = getLangRoot(elements.sourceLang.value);
  const target = elements.targetLang.value;
  if (useBrowserApiKey()) {
    const outputText = await fetchOpenAIContextRevision(segments, source, target);
    const parsed = JSON.parse(outputText);
    return Array.isArray(parsed.segments) ? parsed.segments : [];
  }

  const response = await fetch("/revise-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      target,
      segments: segments.map((segment) => ({
        original: segment.original,
        refined: segment.refined,
        translation: segment.translation,
      })),
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `文脈再補正エラー: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.segments) ? data.segments : [];
}

async function fetchOpenAIContextRevision(segments, source, target) {
  const key = getBrowserApiKey();
  if (!key) throw new Error("OpenAI API Keyを入力してください。");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            `You revise recent meeting transcript segments using nearby context.`,
            `Source language: ${source}. Target language: ${target}.`,
            "Improve only obvious context-dependent transcription mistakes, punctuation, capitalization, and translation choices.",
            "Preserve the number and order of segments. Do not merge or summarize.",
            "Return valid JSON only: {\"segments\":[{\"refined\":\"...\",\"translation\":\"...\"}]}",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            segments: segments.map((segment) => ({
              original: segment.original,
              refined: segment.refined,
              translation: segment.translation,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "context_revision",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["segments"],
            properties: {
              segments: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["refined", "translation"],
                  properties: {
                    refined: { type: "string" },
                    translation: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  return parseOpenAIOutputText(data);
}

function scheduleContextRevision() {
  if (isRealtimeMode()) return;
  clearTimeout(state.contextTimer);
  if (state.segments.length < 2) return;
  state.contextTimer = window.setTimeout(runContextRevision, CONTEXT_REVISE_MS);
}

function scheduleRealtimeHistoryFlush() {
  clearTimeout(state.realtimeHistoryTimer);
  const candidate = state.realtimeTranslationBuffer.trim();
  const delay = looksLikeSentenceEnd(candidate) ? SENTENCE_END_DELAY_MS : SILENCE_DELAY_MS;
  state.realtimeHistoryTimer = window.setTimeout(flushRealtimeHistory, delay);
}

function flushRealtimeHistory() {
  clearTimeout(state.realtimeHistoryTimer);
  const sourceText = basicRefineText(state.realtimeSourceBuffer);
  const translationText = state.realtimeTranslationBuffer.trim();
  state.realtimeSourceBuffer = "";
  state.realtimeTranslationBuffer = "";

  if (!sourceText && !translationText) return;

  const segment = {
    time: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
    original: sourceText,
    refined: sourceText,
    translation: translationText,
  };
  state.transcript.push(sourceText);
  state.refined.push(sourceText);
  state.translations.push(translationText);
  state.segments.push(segment);
  renderHistoryItem(segment);
}

function getRealtimeTargetLanguage() {
  const languageMap = {
    en: "en",
    ja: "ja",
    ko: "ko",
    zh: "zh",
    fr: "fr",
    de: "de",
    es: "es",
  };
  return languageMap[elements.targetLang.value] || elements.targetLang.value;
}

function cleanupRealtime() {
  clearTimeout(state.realtimeHistoryTimer);
  flushRealtimeHistory();

  if (state.realtime?.audio) {
    state.realtime.audio.pause();
    state.realtime.audio.srcObject = null;
  }
  state.realtime?.stream?.getTracks().forEach((track) => track.stop());
  state.realtime?.pc?.getSenders().forEach((sender) => sender.track?.stop());
  state.realtime?.pc?.close();
  state.realtime = null;
}

function handleRealtimeEvent(event) {
  if (event.type === "session.input_transcript.delta") {
    state.realtimeSourceBuffer += event.delta || "";
    appendRealtimeDelta(elements.transcriptText, event.delta || "");
    appendRealtimeDelta(elements.refinedText, event.delta || "");
    elements.refineHint.textContent = "Realtime入力を受信中...";
    scheduleRealtimeHistoryFlush();
    return;
  }

  if (event.type === "session.output_transcript.delta") {
    state.realtimeTranslationBuffer += event.delta || "";
    appendRealtimeDelta(elements.translationText, event.delta || "");
    elements.translationHint.textContent = "";
    scheduleRealtimeHistoryFlush();
    return;
  }

  if (event.type === "session.created") {
    elements.refineHint.textContent = "Realtime接続中";
    return;
  }

  if (event.type === "error") {
    elements.translationHint.textContent = event.error?.message || "Realtime APIエラー";
  }
}

async function startRealtimeTranslation() {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error("このブラウザはRealtime WebRTCに対応していません。");
  }

  cleanupRealtime();
  updateStatus("接続中", true);
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = false;
  elements.refineHint.textContent = "Realtimeセッションを準備中...";
  elements.translationHint.textContent = "マイク許可を待っています...";

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const session = await createRealtimeSession(getRealtimeTargetLanguage(), stream);
  const clientSecret = session.client_secret?.value || session.client_secret;
  if (!clientSecret) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Realtime client secretを取得できませんでした。");
  }

  const pc = new RTCPeerConnection();
  const events = pc.createDataChannel("oai-events");
  const translatedAudio = new Audio();
  translatedAudio.autoplay = true;

  pc.ontrack = ({ streams }) => {
    translatedAudio.srcObject = streams[0];
  };

  events.addEventListener("message", ({ data }) => {
    try {
      handleRealtimeEvent(JSON.parse(data));
    } catch {
      elements.translationHint.textContent = "Realtimeイベントを読み取れませんでした。";
    }
  });

  events.addEventListener("open", () => {
    updateStatus("Realtime中", true);
    elements.refineHint.textContent = "Realtime翻訳中";
    elements.translationHint.textContent = "";
  });

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      updateStatus("再接続が必要");
    }
  });

  for (const track of stream.getAudioTracks()) {
    pc.addTrack(track, stream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });

  if (!sdpResponse.ok) {
    const detail = await sdpResponse.text();
    stream.getTracks().forEach((track) => track.stop());
    pc.close();
    throw new Error(detail || `Realtime接続エラー: ${sdpResponse.status}`);
  }

  await pc.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text(),
  });

  state.realtime = { pc, stream, events, audio: translatedAudio };
  state.listening = true;
  state.manualStop = false;
}

async function createRealtimeSession(targetLanguage, stream) {
  const payload = {
    session: {
      model: "gpt-realtime-translate",
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
          noise_reduction: { type: "near_field" },
        },
        output: { language: targetLanguage },
      },
    },
  };

  if (useBrowserApiKey()) {
    const key = getBrowserApiKey();
    if (!key) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("OpenAI API Keyを入力してください。");
    }

    const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(data.error?.message || `Realtimeセッション作成エラー: ${response.status}`);
    }
    return data;
  }

  const sessionResponse = await fetch("/realtime-translation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLanguage }),
  });

  if (!sessionResponse.ok) {
    const data = await sessionResponse.json().catch(() => ({}));
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(data.error || `Realtimeセッション作成エラー: ${sessionResponse.status}`);
  }

  return sessionResponse.json();
}

function runContextRevision() {
  const start = Math.max(0, state.segments.length - CONTEXT_SEGMENT_LIMIT);
  const targetSegments = state.segments.slice(start);
  if (targetSegments.length < 2) return;

  elements.refineHint.textContent = "前後の文脈で再補正中...";
  state.processingQueue = state.processingQueue
    .then(async () => {
      const revisedSegments = await reviseContextSegments(targetSegments);
      let changed = false;

      revisedSegments.forEach((revised, index) => {
        const segment = targetSegments[index];
        if (!segment) return;

        const nextRefined = revised.refined || segment.refined;
        const nextTranslation = revised.translation || segment.translation;
        if (nextRefined !== segment.refined || nextTranslation !== segment.translation) {
          segment.refined = nextRefined;
          segment.translation = nextTranslation;
          changed = true;
        }
      });

      if (changed) {
        state.refined = state.segments.map((segment) => segment.refined);
        state.translations = state.segments.map((segment) => segment.translation);
        replaceLiveText(elements.refinedText, state.refined);
        replaceLiveText(elements.translationText, state.translations);
        renderHistory();
        elements.refineHint.textContent = "文脈で再補正しました。";
      } else {
        elements.refineHint.textContent = "";
      }
    })
    .catch((error) => {
      elements.refineHint.textContent = error.message;
    });
}

async function getBrowserTranslator(source, target) {
  const key = `${source}:${target}`;
  if (state.translator && state.translatorKey === key) return state.translator;

  if ("Translator" in window && typeof window.Translator.create === "function") {
    const availability = await window.Translator.availability?.({ sourceLanguage: source, targetLanguage: target });
    if (!availability || availability === "available" || availability === "downloadable") {
      state.translator = await window.Translator.create({ sourceLanguage: source, targetLanguage: target });
      state.translatorKey = key;
      return state.translator;
    }
  }

  if (window.ai?.translator?.create) {
    state.translator = await window.ai.translator.create({ sourceLanguage: source, targetLanguage: target });
    state.translatorKey = key;
    return state.translator;
  }

  throw new Error("ブラウザ内蔵翻訳が利用できません。LibreTranslateを選んでください。");
}

async function translateText(text) {
  const mode = elements.translatorMode.value;
  if (mode === "off") return "";

  const source = getLangRoot(elements.sourceLang.value);
  const target = elements.targetLang.value;
  if (source === target) return text;

  if (mode === "browser") {
    const translator = await getBrowserTranslator(source, target);
    return translator.translate(text);
  }

  if (mode === "local") {
    const response = await fetch("/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, target }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `ローカル翻訳エラー: ${response.status}`);
    }

    const data = await response.json();
    return data.translatedText || "";
  }

  if (mode === "openai") {
    if (useBrowserApiKey()) {
      return fetchOpenAITextTask(`Translate from ${source} to ${target}. Return only the translated text.`, text);
    }

    const response = await fetch("/translate/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, target }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `OpenAI翻訳エラー: ${response.status}`);
    }

    const data = await response.json();
    return data.translatedText || "";
  }

  const endpoint = elements.libreEndpoint.value.trim();
  if (!endpoint) throw new Error("LibreTranslate URLを入力してください。");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source,
      target,
      format: "text",
      api_key: elements.libreKey.value.trim() || undefined,
    }),
  });

  if (!response.ok) throw new Error(`翻訳エラー: ${response.status}`);
  const data = await response.json();
  return data.translatedText || "";
}

async function handleFinalTranscript(text, options = {}) {
  const { appendOriginal = true } = options;
  const cleanText = text.trim();
  if (!cleanText) return;

  state.transcript.push(cleanText);
  if (appendOriginal) {
    appendLiveText(elements.transcriptText, cleanText);
  }
  elements.interimText.textContent = "";
  elements.refineHint.textContent = "文脈補正中...";
  elements.translationHint.textContent = "翻訳中...";

  let refinedText = basicRefineText(cleanText);
  let translated = "";
  try {
    try {
      refinedText = await refineText(cleanText);
    } catch (error) {
      elements.refineHint.textContent = `${error.message} 基本整形で続行します。`;
    }

    state.refined.push(refinedText);
    appendLiveText(elements.refinedText, refinedText);
    if (elements.refineHint.textContent === "文脈補正中...") {
      elements.refineHint.textContent = "";
    }

    translated = await translateText(refinedText);
    if (translated) {
      state.translations.push(translated);
      appendLiveText(elements.translationText, translated);
      elements.translationHint.textContent = "";
    } else {
      elements.translationHint.textContent = "翻訳なし";
    }
  } catch (error) {
    elements.translationHint.textContent = error.message;
  }

  const segment = {
    time: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
    original: cleanText,
    refined: refinedText,
    translation: translated,
  };
  state.segments.push(segment);
  renderHistoryItem(segment);
  scheduleContextRevision();
}

function scheduleBufferedTranscript(text) {
  const cleanText = text.trim();
  if (!cleanText) return;

  if (!state.pendingStartedAt) {
    state.pendingStartedAt = Date.now();
  }

  state.pendingTranscript.push(cleanText);
  clearTimeout(state.flushTimer);
  clearTimeout(state.contextTimer);

  if (Date.now() - state.pendingStartedAt >= MAX_BUFFER_MS) {
    flushBufferedTranscript();
    return;
  }

  const bufferedText = state.pendingTranscript.join(" ");
  if (looksLikeSentenceEnd(bufferedText)) {
    elements.refineHint.textContent = "文末を検出しました...";
    state.flushTimer = window.setTimeout(flushBufferedTranscript, SENTENCE_END_DELAY_MS);
    return;
  }

  elements.refineHint.textContent = "発話の区切りを待っています...";
  state.flushTimer = window.setTimeout(flushBufferedTranscript, SILENCE_DELAY_MS);
}

function flushBufferedTranscript() {
  clearTimeout(state.flushTimer);
  const text = state.pendingTranscript.join(" ").trim();
  state.pendingTranscript = [];
  state.pendingStartedAt = 0;
  if (!text) return;

  state.processingQueue = state.processingQueue.then(() => handleFinalTranscript(text));
}

function setupRecognition() {
  if (!SpeechRecognition) {
    updateStatus("未対応");
    elements.startBtn.disabled = true;
    elements.interimText.textContent = "このブラウザは音声認識に対応していません。ChromeまたはSafariで開いてください。";
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = elements.sourceLang.value;

  recognition.onstart = () => {
    state.listening = true;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    updateStatus("録音中", true);
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript || "";
      if (result.isFinal) {
        scheduleBufferedTranscript(text);
      } else {
        interim += text;
      }
    }
    elements.interimText.textContent = interim;
  };

  recognition.onerror = (event) => {
    updateStatus("確認が必要");
    elements.interimText.textContent = `音声認識エラー: ${event.error}`;
  };

  recognition.onend = () => {
    state.listening = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    updateStatus("待機中");
    if (!state.manualStop) {
      window.setTimeout(() => startListening(), 450);
    }
  };

  return recognition;
}

function startListening() {
  saveSettings();
  updateBadges();
  state.manualStop = false;
  if (isRealtimeMode()) {
    startRealtimeTranslation().catch((error) => {
      cleanupRealtime();
      state.listening = false;
      elements.startBtn.disabled = false;
      elements.stopBtn.disabled = true;
      updateStatus("確認が必要");
      elements.translationHint.textContent = error.message;
    });
    return;
  }
  state.recognition = setupRecognition();
  state.recognition?.start();
}

function stopListening() {
  state.manualStop = true;
  if (isRealtimeMode()) {
    cleanupRealtime();
    state.listening = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    updateStatus("待機中");
    elements.refineHint.textContent = "この文章を翻訳に使います。";
    return;
  }
  flushBufferedTranscript();
  state.recognition?.stop();
}

async function translateTypedInput() {
  const text = elements.transcriptText.value.trim();
  if (!text) {
    elements.translationHint.textContent = "文字起こし欄に翻訳したい文章を入力してください。";
    return;
  }
  await handleFinalTranscript(text, { appendOriginal: false });
}

async function copyText(text) {
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  updateStatus("コピー済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

async function copyHistory() {
  await copyText(buildExportText());
}

function buildExportText() {
  return state.segments
    .map((segment) => `[${segment.time}]\n補正: ${segment.refined || ""}\n訳文: ${segment.translation || ""}`)
    .join("\n\n");
}

function downloadHistory() {
  const blob = new Blob([buildExportText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `meeting-transcript-${stamp}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clearHistory() {
  state.transcript = [];
  state.refined = [];
  state.translations = [];
  state.segments = [];
  state.pendingTranscript = [];
  state.pendingStartedAt = 0;
  state.realtimeSourceBuffer = "";
  state.realtimeTranslationBuffer = "";
  clearTimeout(state.flushTimer);
  clearTimeout(state.realtimeHistoryTimer);
  cleanupRealtime();
  elements.transcriptText.value = "";
  elements.refinedText.value = "";
  elements.translationText.value = "";
  elements.historyList.replaceChildren();
  elements.interimText.textContent = "";
  elements.refineHint.textContent = "この文章を翻訳に使います。";
  elements.translationHint.textContent = "翻訳結果がここに表示されます。";
}

elements.startBtn.addEventListener("click", startListening);
elements.stopBtn.addEventListener("click", stopListening);
elements.translateInputBtn.addEventListener("click", translateTypedInput);
elements.copyTranscriptBtn.addEventListener("click", () => copyText(elements.transcriptText.value));
elements.copyRefinedBtn.addEventListener("click", () => copyText(elements.refinedText.value));
elements.copyTranslationBtn.addEventListener("click", () => copyText(elements.translationText.value));
elements.copyBtn.addEventListener("click", copyHistory);
elements.downloadBtn.addEventListener("click", downloadHistory);
elements.clearBtn.addEventListener("click", clearHistory);

for (const control of [elements.sourceLang, elements.targetLang, elements.translatorMode, elements.libreEndpoint, elements.libreKey]) {
  control.addEventListener("change", () => {
    toggleLibreSettings();
    toggleApiSettings();
    updateBadges();
    saveSettings();
  });
}

elements.apiMode.addEventListener("change", () => {
  toggleApiSettings();
  saveSettings();
});
elements.saveBrowserKeyBtn.addEventListener("click", saveBrowserApiKey);
elements.clearBrowserKeyBtn.addEventListener("click", clearBrowserApiKey);

loadSettings();
setupRecognition();
