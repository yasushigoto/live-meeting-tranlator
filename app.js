const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SILENCE_DELAY_MS = 1800;
const SENTENCE_END_DELAY_MS = 450;
const REALTIME_FRAGMENT_DELAY_MS = 10000;
const MAX_BUFFER_MS = 15000;
const HISTORY_MIN_WORDS = 10;
const HISTORY_SOFT_WORD_LIMIT = 24;
const HISTORY_SOFT_CHAR_LIMIT = 120;
const HISTORY_TIMED_FLUSH_MS = 6500;
const HISTORY_HARD_FLUSH_MS = 12000;
const SUMMARY_INTERVAL_MS = 60000;
const OPENAI_AUDIO_CHUNK_MS = 2200;
const REALTIME_TRANSCRIPT_TIMEOUT_MS = 8000;
const REALTIME_TRANSCRIPTION_SILENCE_MS = 700;
const REALTIME_TRANSCRIPTION_MAX_CHUNK_MS = 8000;
const REALTIME_TRANSCRIPTION_MIN_CHUNK_MS = 900;

const elements = {
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  translateInputBtn: document.querySelector("#translateInputBtn"),
  sourceLang: document.querySelector("#sourceLang"),
  targetLang: document.querySelector("#targetLang"),
  translatorMode: document.querySelector("#translatorMode"),
  settingsRow: document.querySelector("#settingsRow"),
  apiMode: document.querySelector("#apiMode"),
  apiSettings: document.querySelector("#apiSettings"),
  browserKeyField: document.querySelector("#browserKeyField"),
  browserApiKey: document.querySelector("#browserApiKey"),
  showBrowserKeyActions: document.querySelector("#showBrowserKeyActions"),
  showBrowserKeyBtn: document.querySelector("#showBrowserKeyBtn"),
  browserKeyActions: document.querySelector("#browserKeyActions"),
  saveBrowserKeyBtn: document.querySelector("#saveBrowserKeyBtn"),
  clearBrowserKeyBtn: document.querySelector("#clearBrowserKeyBtn"),
  apiNote: document.querySelector("#apiNote"),
  libreSettings: document.querySelector("#libreSettings"),
  libreEndpoint: document.querySelector("#libreEndpoint"),
  libreKey: document.querySelector("#libreKey"),
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  sourceBadge: document.querySelector("#sourceBadge"),
  targetBadge: document.querySelector("#targetBadge"),
  refinedTargetBadge: document.querySelector("#refinedTargetBadge"),
  transcriptText: document.querySelector("#transcriptText"),
  refinedText: document.querySelector("#refinedText"),
  translationText: document.querySelector("#translationText"),
  refinedTranslationText: document.querySelector("#refinedTranslationText"),
  interimText: document.querySelector("#interimText"),
  refineHint: document.querySelector("#refineHint"),
  translationHint: document.querySelector("#translationHint"),
  historyList: document.querySelector("#historyList"),
  copyTranscriptBtn: document.querySelector("#copyTranscriptBtn"),
  copyRefinedBtn: document.querySelector("#copyRefinedBtn"),
  copyTranslationBtn: document.querySelector("#copyTranslationBtn"),
  copyRefinedTranslationBtn: document.querySelector("#copyRefinedTranslationBtn"),
  copyAllBtn: document.querySelector("#copyAllBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  audioInputSelect: document.querySelector("#audioInputSelect"),
  refreshDevicesBtn: document.querySelector("#refreshDevicesBtn"),
  deviceNote: document.querySelector("#deviceNote"),
  audioLevelBar: document.querySelector("#audioLevelBar"),
  itemTemplate: document.querySelector("#historyItemTemplate"),
  apiKeyDialog: document.querySelector("#apiKeyDialog"),
  dialogApiKey: document.querySelector("#dialogApiKey"),
  dialogApiKeyError: document.querySelector("#dialogApiKeyError"),
  cancelApiKeyBtn: document.querySelector("#cancelApiKeyBtn"),
  confirmApiKeyBtn: document.querySelector("#confirmApiKeyBtn"),
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
  summaryTimer: null,
  realtime: null,
  realtimeTranscription: null,
  realtimeSourceBuffer: "",
  realtimeTranslationBuffer: "",
  realtimeBufferStartedAt: 0,
  realtimeHistoryTimer: null,
  realtimeTranscriptTimer: null,
  realtimeTranscriptReceived: false,
  realtimeLastSourceAt: 0,
  realtimeLastOutputAt: 0,
  processingQueue: Promise.resolve(),
  translator: null,
  translatorKey: "",
  audioMonitor: null,
  activeCaptureMode: "",
  openaiAudio: null,
  apiKeyEditorOpen: false,
  audioInputTouched: false,
  summaryText: "",
  summaries: [],
  lastSummarySegmentCount: 0,
};

const storageKey = "live-meeting-translator-settings";
const browserApiKeyStorageKey = "live-meeting-translator-openai-key";

function isLocalServerPage() {
  return ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
}

function shouldForceBrowserApiMode() {
  return usesOpenAI() && (location.protocol === "file:" || !isLocalServerPage());
}

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
  if (shouldForceBrowserApiMode()) {
    elements.apiMode.value = "browser";
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
    audioInputId: elements.audioInputSelect.value,
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
  if (elements.refinedTargetBadge) {
    elements.refinedTargetBadge.textContent = elements.targetLang.value;
  }
}

function updateDeviceModeNote() {
  if (isRealtimeMode() || elements.translatorMode.value === "openai") return;
  elements.deviceNote.textContent =
    "会議音声は通常BlackHoleを使います。他の翻訳エンジンではブラウザ/OSの既定マイクが使われます。";
}

function findBlackHoleOption() {
  return [...elements.audioInputSelect.options].find((option) => /blackhole/i.test(option.textContent || ""));
}

async function refreshAudioInputs({ requestPermission = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.deviceNote.textContent = "このブラウザでは音源一覧を取得できません。";
    return;
  }

  const currentValue = elements.audioInputSelect.value;
  if (requestPermission) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      elements.deviceNote.textContent = `マイク許可が必要です: ${error.message}`;
      return;
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter(
    (device) => device.kind === "audioinput" && device.deviceId !== "default" && device.deviceId !== "communications",
  );
  elements.audioInputSelect.replaceChildren(new Option("システム既定", ""));

  audioInputs.forEach((device, index) => {
    elements.audioInputSelect.append(new Option(device.label || `音源 ${index + 1}`, device.deviceId));
  });

  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const blackHoleOption = findBlackHoleOption();
  const preferredValue =
    !state.audioInputTouched && blackHoleOption
      ? blackHoleOption.value
      : currentValue || (saved.audioInputId === "default" ? "" : saved.audioInputId) || "";
  if ([...elements.audioInputSelect.options].some((option) => option.value === preferredValue)) {
    elements.audioInputSelect.value = preferredValue;
  }

  const selectedLabel = elements.audioInputSelect.selectedOptions[0]?.textContent || "システム既定";
  elements.deviceNote.textContent =
    audioInputs.length
      ? blackHoleOption
        ? `会議音声入力: ${selectedLabel}。通常はBlackHoleを選びます。`
        : `現在の音源: ${selectedLabel}。BlackHoleが見つかりません。`
      : "入力音源がまだ見えていません。音源を更新してマイクを許可してください。Macの出力先だけでは表示されません。";
  updateDeviceModeNote();
  saveSettings();
}

function getSelectedAudioLabel() {
  return elements.audioInputSelect.selectedOptions[0]?.textContent || "システム既定";
}

function getAudioConstraints() {
  const deviceId = elements.audioInputSelect.value;
  const hasSelectedDevice = Boolean(deviceId);
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: !hasSelectedDevice,
      noiseSuppression: !hasSelectedDevice,
      autoGainControl: !hasSelectedDevice,
    },
  };
}

async function getPreferredAudioStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(getAudioConstraints());
  } catch (error) {
    if (!elements.audioInputSelect.value) {
      throw error;
    }

    throw new Error(`${getSelectedAudioLabel()}を開けませんでした。音源を更新して選び直してください。`);
  }
}

function formatAudioError(error) {
  if (error?.name === "NotAllowedError") {
    return "マイク使用が許可されていません。ブラウザまたはmacOSのマイク権限を確認してください。";
  }
  if (error?.name === "NotFoundError") {
    return "使用できる音声入力が見つかりません。音源を更新して、BlackHoleやAggregate Deviceを選び直してください。";
  }
  if (error?.name === "NotReadableError") {
    return "音声入力を開けませんでした。ほかのアプリが同じ音源を占有していないか確認してください。";
  }
  if (error?.name === "OverconstrainedError") {
    return "選択した音源を使えませんでした。音源を更新するか、システム既定を選んでください。";
  }
  return error?.message || "音声入力を開始できませんでした。";
}

function stopAudioMonitor() {
  if (state.audioMonitor?.frameId) {
    cancelAnimationFrame(state.audioMonitor.frameId);
  }
  state.audioMonitor?.context?.close?.();
  state.audioMonitor = null;
  if (elements.audioLevelBar) {
    elements.audioLevelBar.style.width = "0%";
  }
}

function startAudioMonitor(stream) {
  stopAudioMonitor();
  if (!window.AudioContext && !window.webkitAudioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;

  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) {
      const centered = value - 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / samples.length);
    const level = Math.min(100, Math.round(Math.pow(rms / 18, 0.62) * 100));
    elements.audioLevelBar.style.width = `${level}%`;
    state.audioMonitor.frameId = requestAnimationFrame(tick);
  };

  state.audioMonitor = { context, frameId: requestAnimationFrame(tick) };
}

function toggleLibreSettings() {
  elements.libreSettings.hidden = elements.translatorMode.value !== "libre";
  updateDeviceModeNote();
}

function usesOpenAI() {
  return elements.translatorMode.value === "realtime" || elements.translatorMode.value === "openai";
}

function useBrowserApiKey() {
  return usesOpenAI() && elements.apiMode.value === "browser";
}

function toggleApiSettings() {
  elements.apiSettings.hidden = !usesOpenAI();
  if (shouldForceBrowserApiMode()) {
    elements.apiMode.value = "browser";
  }
  const showBrowserKeyButton = useBrowserApiKey();
  elements.settingsRow.classList.remove("key-visible");
  elements.apiSettings.classList.remove("key-visible");
  elements.showBrowserKeyActions.hidden = !showBrowserKeyButton;
  elements.browserKeyField.hidden = true;
  elements.browserKeyActions.hidden = true;
  const hasSavedBrowserKey = Boolean(localStorage.getItem(browserApiKeyStorageKey));
  elements.showBrowserKeyBtn.textContent = hasSavedBrowserKey ? "APIキー変更" : "APIキー設定";
  elements.apiNote.textContent =
    shouldForceBrowserApiMode()
      ? "サーバーなしで開いているため、OpenAIはブラウザ保存キーで直接接続します。"
      : useBrowserApiKey() && hasSavedBrowserKey
        ? "APIキーはこのブラウザに保存済みです。変更する場合は入力し直して保存してください。"
      : "";
}

function getBrowserApiKey() {
  return elements.browserApiKey.value.trim() || localStorage.getItem(browserApiKeyStorageKey) || "";
}

function promptAndSaveBrowserApiKey() {
  elements.dialogApiKey.value = "";
  elements.dialogApiKeyError.textContent = "";
  elements.apiKeyDialog.showModal();
  window.setTimeout(() => elements.dialogApiKey.focus(), 0);
}

function saveDialogApiKey() {
  const key = elements.dialogApiKey.value.trim();
  if (!key) {
    elements.dialogApiKeyError.textContent = "APIキーを入力してください。";
    return;
  }

  localStorage.setItem(browserApiKeyStorageKey, key);
  elements.browserApiKey.value = "";
  elements.apiNote.textContent = "APIキーをこのブラウザに保存しました。";
  elements.translationHint.textContent = "APIキーを保存しました。";
  elements.apiKeyDialog.close();
  toggleApiSettings();
  updateStatus("APIキー保存済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

function saveBrowserApiKey() {
  const key = elements.browserApiKey.value.trim();
  if (!key) {
    elements.translationHint.textContent = "保存するOpenAI API Keyを入力してください。";
    return;
  }
  localStorage.setItem(browserApiKeyStorageKey, key);
  elements.browserApiKey.value = key;
  elements.apiNote.textContent = "APIキーをこのブラウザに保存しました。";
  elements.translationHint.textContent = "APIキーを保存しました。";
  state.apiKeyEditorOpen = false;
  toggleApiSettings();
  updateStatus("APIキー保存済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

function clearBrowserApiKey() {
  localStorage.removeItem(browserApiKeyStorageKey);
  elements.browserApiKey.value = "";
  state.apiKeyEditorOpen = true;
  elements.apiNote.textContent = "APIキーを削除しました。";
  toggleApiSettings();
  updateStatus("APIキー削除済み");
  window.setTimeout(() => updateStatus(state.listening ? "録音中" : "待機中", state.listening), 1200);
}

function formatLiveLines(lines, { newestFirst = false, separator = "\n" } = {}) {
  const visibleLines = lines.filter(Boolean);
  return (newestFirst ? [...visibleLines].reverse() : visibleLines).join(separator);
}

function appendLiveText(target, text) {
  if (!text) return;
  const shouldStickToBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
  target.value = target.value ? `${target.value}\n${text}` : text;
  if (shouldStickToBottom) {
    target.scrollTop = target.scrollHeight;
  }
}

function replaceLiveText(target, lines, options = {}) {
  const shouldStickToBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
  target.value = formatLiveLines(lines, options);
  if (shouldStickToBottom) {
    target.scrollTop = target.scrollHeight;
  }
}

function enqueueProcessing(task) {
  state.processingQueue = state.processingQueue
    .catch(() => undefined)
    .then(task)
    .catch((error) => {
      elements.translationHint.textContent = error.message || "処理を続行できませんでした。";
    });
  return state.processingQueue;
}

function showPendingProcessingAfterStop() {
  elements.refineHint.textContent = "最後の要約を準備しています...";
  elements.translationHint.textContent = "残りの翻訳を続けています...";
  window.setTimeout(() => {
    state.processingQueue.finally(() => {
      if (!state.listening) {
        elements.refineHint.textContent = "停止後の要約まで完了しました。";
        elements.translationHint.textContent = "停止後の翻訳まで完了しました。";
      }
    });
  }, 0);
}

function renderHistoryItem(segment) {
  if (!segment.translation) return;
  const fragment = elements.itemTemplate.content.cloneNode(true);
  const stats = getSegmentStats(segment.original || "");
  const item = fragment.querySelector("li");
  item.classList.toggle("short", stats.words <= 8 && stats.chars <= 48);
  fragment.querySelector("time").textContent = segment.time;
  fragment.querySelector(".segment-meta").textContent =
    stats.words > 1 ? `${stats.words} words` : `${stats.chars} chars`;
  fragment.querySelector(".refined span").textContent = segment.original || "";
  const translationRow = fragment.querySelector(".translation");
  translationRow.querySelector("span").textContent = segment.translation;
  elements.historyList.prepend(fragment);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  for (const segment of state.segments) {
    renderHistoryItem(segment);
  }
}

function isTinyRealtimeFragment(sourceText, translationText) {
  const combined = `${sourceText} ${translationText}`.trim();
  if (!combined) return true;
  if (/^[\s、。，．,.!?！？-]+$/.test(combined)) return true;
  const textForLength = combined.replace(/[\s、。，．,.!?！？-]/g, "");
  return textForLength.length < 4;
}

function cleanRealtimeSegmentText(text) {
  return text
    .replace(/^\s*[、。，．,.!?！？]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSegmentStats(text) {
  const cleaned = cleanRealtimeSegmentText(text);
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  const cjkChars = (cleaned.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  const chars = cleaned.replace(/\s/g, "").length;
  return {
    words: words || Math.ceil(cjkChars / 2) || (chars ? 1 : 0),
    chars,
  };
}

function hasLongEnoughRealtimeBuffer(sourceText, translationText) {
  const stats = getSegmentStats(sourceText);
  const translationLength = translationText.replace(/\s/g, "").length;
  return stats.words >= HISTORY_SOFT_WORD_LIMIT || stats.chars >= HISTORY_SOFT_CHAR_LIMIT || translationLength >= 80;
}

function shouldFlushRealtimeBuffer(sourceText, translationText, { force = false } = {}) {
  if (!sourceText) return false;
  const stats = getSegmentStats(sourceText);
  if (force) return true;
  if (stats.words < HISTORY_MIN_WORDS) return false;
  if (looksLikeSentenceEnd(sourceText)) return true;
  const elapsed = state.realtimeBufferStartedAt ? Date.now() - state.realtimeBufferStartedAt : 0;
  if (hasLongEnoughRealtimeBuffer(sourceText, translationText)) return true;
  if (elapsed >= HISTORY_TIMED_FLUSH_MS) return true;
  return elapsed >= HISTORY_HARD_FLUSH_MS;
}

function appendToLastSegment(sourceText) {
  const last = state.segments[state.segments.length - 1];
  if (!last) return false;

  if (sourceText) {
    last.original = [last.original, sourceText].filter(Boolean).join(" ");
  }

  state.transcript = state.segments.map((segment) => segment.original);
  refreshStructuredPanels();
  elements.translationText.dataset.realtimePrefixNeeded = "true";
  renderHistory();
  return true;
}

function appendRealtimeDelta(target, text) {
  if (!text) return;
  const shouldStickToBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
  if (target.value && !target.value.endsWith("\n") && target.dataset.realtimePrefixNeeded === "true") {
    target.value += "\n";
    target.dataset.realtimePrefixNeeded = "false";
  }
  target.value += text;
  if (shouldStickToBottom) {
    target.scrollTop = target.scrollHeight;
  }
}

function getDisplayTranslations() {
  return state.segments.map((segment) => segment.translation || "");
}

function shouldPreserveRealtimeTranslation() {
  return state.activeCaptureMode === "realtime" || Boolean(state.realtime);
}

function refreshStructuredPanels() {
  state.translations = getDisplayTranslations();
  elements.refinedText.value = state.summaryText;
  if (elements.refinedTranslationText) {
    elements.refinedTranslationText.value = "";
  }
  if (!shouldPreserveRealtimeTranslation()) {
    replaceLiveText(elements.translationText, state.translations);
  }
}

function splitSourceIntoSentences(text) {
  const cleaned = cleanRealtimeSegmentText(text);
  if (!cleaned) return [];
  const pieces = cleaned.match(/[^。．.!?！？]+[。．.!?！？]+|[^。．.!?！？]+$/g) || [cleaned];
  return groupShortSegments(pieces.flatMap(splitLongSegment).filter(Boolean));
}

function splitLongSegment(text) {
  const cleaned = cleanRealtimeSegmentText(text);
  const stats = getSegmentStats(cleaned);
  if (stats.words <= HISTORY_SOFT_WORD_LIMIT + 8 && stats.chars <= HISTORY_SOFT_CHAR_LIMIT + 40) {
    return [cleaned];
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > HISTORY_SOFT_WORD_LIMIT + 8) {
    const chunks = [];
    for (let index = 0; index < words.length; index += HISTORY_SOFT_WORD_LIMIT) {
      chunks.push(words.slice(index, index + HISTORY_SOFT_WORD_LIMIT).join(" "));
    }
    return chunks;
  }

  const chunks = cleaned.match(new RegExp(`.{1,${HISTORY_SOFT_CHAR_LIMIT}}`, "g")) || [cleaned];
  return chunks.map((chunk) => cleanRealtimeSegmentText(chunk));
}

function groupShortSegments(pieces) {
  const grouped = [];
  let buffer = "";

  for (const piece of pieces) {
    const next = [buffer, piece].filter(Boolean).join(" ");
    if (getSegmentStats(next).words >= HISTORY_MIN_WORDS) {
      grouped.push(next);
      buffer = "";
    } else {
      buffer = next;
    }
  }

  if (buffer) {
    if (grouped.length) {
      grouped[grouped.length - 1] = `${grouped[grouped.length - 1]} ${buffer}`.trim();
    } else {
      grouped.push(buffer);
    }
  }

  return grouped;
}

function getRealtimeTextDelta(event) {
  return (
    event.delta ||
    event.text ||
    event.transcript ||
    event.output_text ||
    event.item?.content?.[0]?.text ||
    event.item?.content?.[0]?.transcript ||
    event.response?.output_text ||
    ""
  );
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
    /\b(done|needed|wanted|thought|knew|agreed|finished|started|confirmed|shared|reviewed|approved|decided|discussed|shipped|launched|went|ok|okay|right)\.?$/i;
  return words.length >= 10 && completeEnglishEndings.test(normalized);
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

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

function cleanSummaryText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(議事|会議|要約|要点|概要|発言|話題|論点|決定事項|重要事実|質問|アクション|次の対応|まとめ|ポイント)[^。！？]*[:：]?\s*$/i.test(line))
    .map((line) =>
      line
        .replace(/^[-*・]\s*(議事|会議|要約|要点|概要|発言の傾向|発言|話題|論点|決定事項|重要事実|質問|アクション|次の対応|まとめ|ポイント)\s*[:：]\s*/i, "- ")
        .replace(/^(議事|会議|要約|要点|概要|発言の傾向|発言|話題|論点|決定事項|重要事実|質問|アクション|次の対応|まとめ|ポイント)\s*[:：]\s*/i, ""),
    )
    .filter((line) => line && line !== "-" && line !== "・")
    .join("\n");
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

async function transcribeAudioWithOpenAI(audioBlob) {
  const source = elements.sourceLang.value;
  if (useBrowserApiKey()) {
    const key = getBrowserApiKey();
    if (!key) throw new Error("OpenAI API Keyを入力してください。");

    const form = new FormData();
    const extension = audioBlob.type.includes("mp4") ? "m4a" : audioBlob.type.includes("ogg") ? "ogg" : "webm";
    form.append("file", audioBlob, `audio.${extension}`);
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", getLangRoot(source));

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `OpenAI transcription error (${response.status})`);
    return data.text || "";
  }

  const response = await fetch(`/transcribe/openai?source=${encodeURIComponent(source)}`, {
    method: "POST",
    headers: { "Content-Type": audioBlob.type || "audio/webm" },
    body: audioBlob,
  }).catch(() => {
    throw new Error("OpenAI API用のローカルサーバーに接続できません。サーバーを再起動してください。");
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 404 || response.status === 405) {
    throw new Error("OpenAI API用の文字起こし機能を使うには、ローカルサーバーの再起動が必要です。");
  }
  if (!response.ok) throw new Error(data.error || `OpenAI文字起こしエラー: ${response.status}`);
  return data.transcriptText || "";
}

async function translateSegments(segments) {
  if (!segments.length) return;
  elements.translationHint.textContent = "履歴用の訳文を作成中...";

  try {
    await Promise.all(segments.map(async (segment) => {
      segment.translation = await translateText(segment.original);
      segment.pendingTranslation = false;
    }));
  } catch (error) {
    elements.translationHint.textContent = error.message;
    segments.forEach((segment) => {
      segment.pendingTranslation = false;
    });
  }

  refreshStructuredPanels();
  renderHistory();
  elements.translationHint.textContent = state.listening ? "Realtime翻訳を受信中..." : "";
}

async function summarizeInJapanese() {
  const transcript = state.segments.map((segment) => segment.original).join("\n");
  if (!transcript.trim()) return "";

  if (useBrowserApiKey()) {
    return fetchOpenAITextTask(
      [
        "Summarize the meeting transcript so far in Japanese.",
        "Use only plain bullet points. Each line must start with '- '.",
        "Do not use headings or labels. Never write category names such as 議事の要点, 発言の傾向, 決定事項, 重要事実, 質問, アクション, まとめ, or ポイント.",
        "Use 2 to 5 short bullets. Omit empty/none sections.",
        "Capture the gist and flow of the discussion. Do not translate line by line.",
      ].join(" "),
      transcript,
    );
  }

  const response = await fetch("/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: transcript }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `要約エラー: ${response.status}`);
  }

  const data = await response.json();
  return data.summaryText || "";
}

function scheduleSummaryUpdate(delay = SUMMARY_INTERVAL_MS) {
  clearTimeout(state.summaryTimer);
  state.summaryTimer = window.setTimeout(runSummaryUpdate, delay);
}

function enqueueFinalSummaryAfterStop() {
  clearTimeout(state.summaryTimer);
  state.summaryTimer = null;
  enqueueProcessing(() => runSummaryUpdate({ final: true }));
}

async function runSummaryUpdate({ final = false } = {}) {
  if (!state.segments.length) {
    if (state.listening) scheduleSummaryUpdate();
    return;
  }
  if (!final && state.lastSummarySegmentCount === state.segments.length) {
    if (state.listening) scheduleSummaryUpdate();
    return;
  }

  elements.refineHint.textContent = final ? "最後の要約を作成中..." : "ここまでの要約を作成中...";
  try {
    const summary = cleanSummaryText(await summarizeInJapanese());
    if (summary) {
      const stamp = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      state.summaries.push({ time: stamp, text: summary });
      state.summaryText = state.summaries.map((item) => `[${item.time}]\n${item.text}`).join("\n\n");
      state.lastSummarySegmentCount = state.segments.length;
      elements.refinedText.value = state.summaryText;
      elements.refinedText.scrollTop = elements.refinedText.scrollHeight;
      elements.refineHint.textContent = final ? "最後の要約を表示しました。" : "ここまでの要約を更新しました。";
    }
  } catch (error) {
    elements.refineHint.textContent = error.message;
  } finally {
    if (state.listening) scheduleSummaryUpdate();
  }
}

function scheduleRealtimeHistoryFlush() {
  clearTimeout(state.realtimeHistoryTimer);
  if (!state.realtimeBufferStartedAt) {
    state.realtimeBufferStartedAt = Date.now();
  }
  const sourceCandidate = state.realtimeSourceBuffer.trim();
  const elapsed = Date.now() - state.realtimeBufferStartedAt;
  const remainingMaxDelay = Math.max(SENTENCE_END_DELAY_MS, MAX_BUFFER_MS - elapsed);
  const remainingHardDelay = Math.max(SENTENCE_END_DELAY_MS, HISTORY_HARD_FLUSH_MS - elapsed);
  const stats = getSegmentStats(sourceCandidate);
  const shouldCheckSoon = stats.words >= HISTORY_MIN_WORDS;
  const delay = looksLikeSentenceEnd(sourceCandidate)
    ? SENTENCE_END_DELAY_MS
    : Math.min(shouldCheckSoon ? HISTORY_TIMED_FLUSH_MS : REALTIME_FRAGMENT_DELAY_MS, remainingMaxDelay, remainingHardDelay);
  state.realtimeHistoryTimer = window.setTimeout(flushRealtimeHistory, delay);
}

function scheduleRealtimeHistoryFlushSoon() {
  scheduleRealtimeHistoryFlush();
}

function flushRealtimeHistory(options = {}) {
  clearTimeout(state.realtimeHistoryTimer);
  const sourceText = cleanRealtimeSegmentText(basicRefineText(state.realtimeSourceBuffer));
  const translationText = cleanRealtimeSegmentText(state.realtimeTranslationBuffer);

  if (!shouldFlushRealtimeBuffer(sourceText, translationText, options)) {
    scheduleRealtimeHistoryFlush();
    return;
  }

  state.realtimeSourceBuffer = "";
  state.realtimeTranslationBuffer = "";
  state.realtimeBufferStartedAt = 0;

  if (!sourceText) return;
  if (isTinyRealtimeFragment(sourceText, translationText)) {
    if (!appendToLastSegment(sourceText)) {
      return;
    }
    return;
  }

  const sourceSentences = splitSourceIntoSentences(sourceText);
  const createdSegments = sourceSentences.map((sentence) => ({
    time: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
    original: sentence,
    translation: "",
    pendingTranslation: true,
  }));

  for (const segment of createdSegments) {
    state.transcript.push(segment.original);
    state.segments.push(segment);
  }
  refreshStructuredPanels();
  elements.translationText.dataset.realtimePrefixNeeded = "true";
  renderHistory();
  enqueueProcessing(() => translateSegments(createdSegments));
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

function getRealtimeClientSecret(session) {
  return session?.client_secret?.value || session?.client_secret || session?.value || "";
}

function cleanupRealtime() {
  clearTimeout(state.realtimeHistoryTimer);
  clearTimeout(state.realtimeTranscriptTimer);
  flushRealtimeHistory({ force: true });
  stopAudioMonitor();

  if (state.realtime?.audio) {
    state.realtime.audio.muted = true;
    state.realtime.audio.pause();
    state.realtime.audio.srcObject = null;
  }
  state.realtime?.stream?.getTracks().forEach((track) => track.stop());
  state.realtime?.pc?.getSenders().forEach((sender) => sender.track?.stop());
  state.realtime?.pc?.close();
  state.realtimeTranscription?.pc?.close();
  if (state.realtimeTranscription?.frameId) {
    cancelAnimationFrame(state.realtimeTranscription.frameId);
  }
  state.realtimeTranscription?.context?.close?.();
  state.realtime = null;
  state.realtimeTranscription = null;
  if (state.activeCaptureMode === "realtime") {
    state.activeCaptureMode = "";
  }
}

function getRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function cleanupOpenAIAudio() {
  const recorder = state.openaiAudio?.recorder;
  clearTimeout(state.openaiAudio?.segmentTimer);
  if (state.openaiAudio) {
    state.openaiAudio.finalizing = true;
  }
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
  state.openaiAudio?.stream?.getTracks().forEach((track) => track.stop());
  const finishingSession = state.openaiAudio;
  window.setTimeout(() => {
    if (state.openaiAudio === finishingSession) {
      state.openaiAudio = null;
    }
  }, 0);
  stopAudioMonitor();
  if (state.activeCaptureMode === "openai-audio") {
    state.activeCaptureMode = "";
  }
}

function recordNextOpenAIAudioSegment() {
  const session = state.openaiAudio;
  if (!state.listening || state.activeCaptureMode !== "openai-audio" || !session?.stream) return;

  const chunks = [];
  const recorder = new MediaRecorder(session.stream, session.mimeType ? { mimeType: session.mimeType } : undefined);
  session.recorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    if (chunks.length && (state.listening || session.finalizing)) {
      const audioBlob = new Blob(chunks, { type: recorder.mimeType || session.mimeType || "audio/webm" });
      enqueueProcessing(() => processOpenAIAudioChunk(audioBlob));
    }
    if (state.listening && state.activeCaptureMode === "openai-audio") {
      recordNextOpenAIAudioSegment();
    }
  });

  recorder.start();
  session.segmentTimer = window.setTimeout(() => {
    if (recorder.state === "recording") {
      recorder.stop();
    }
  }, OPENAI_AUDIO_CHUNK_MS);
}

async function processOpenAIAudioChunk(audioBlob) {
  if (!audioBlob.size) return;
  elements.interimText.textContent = "OpenAIで文字起こし中...";
  try {
    const text = await transcribeAudioWithOpenAI(audioBlob);
    const cleanText = text.trim();
    if (cleanText) {
      await handleFinalTranscript(cleanText);
    }
    if (state.listening && state.activeCaptureMode === "openai-audio") {
      elements.interimText.textContent = "OpenAI APIで音声入力中...";
    }
  } catch (error) {
    elements.interimText.textContent = error.message;
    elements.translationHint.textContent = error.message;
  }
}

async function startOpenAIAudioTranscription() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("このブラウザは音声録音に対応していません。");
  }

  cleanupOpenAIAudio();
  updateStatus("録音中", true);
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = false;
  elements.refineHint.textContent = "1分くらいの間隔で要約します。";
  elements.translationHint.textContent = "";
  elements.interimText.textContent = "OpenAI APIで音声入力中...";

  const stream = await getPreferredAudioStream();
  startAudioMonitor(stream);

  const activeTrack = stream.getAudioTracks()[0];
  if (activeTrack?.label) {
    const settings = activeTrack.getSettings?.() || {};
    const channelText = settings.channelCount ? ` / ${settings.channelCount}ch` : "";
    const rateText = settings.sampleRate ? ` / ${settings.sampleRate}Hz` : "";
    elements.deviceNote.textContent = `使用中の音源: ${activeTrack.label}${channelText}${rateText}`;
  }

  const mimeType = getRecorderMimeType();
  state.openaiAudio = { recorder: null, stream, mimeType, segmentTimer: null };
  state.listening = true;
  state.manualStop = false;
  state.activeCaptureMode = "openai-audio";
  scheduleSummaryUpdate();
  recordNextOpenAIAudioSegment();
}

function handleRealtimeEvent(event) {
  const delta = getRealtimeTextDelta(event);
  const lowerType = event.type || "";

  if ((lowerType.includes("input") || lowerType.includes("conversation.item.input")) && lowerType.includes("transcript") && delta) {
    state.realtimeTranscriptReceived = true;
    state.realtimeLastSourceAt = Date.now();
    clearTimeout(state.realtimeTranscriptTimer);
    state.realtimeSourceBuffer += delta;
    appendRealtimeDelta(elements.transcriptText, delta);
    elements.refineHint.textContent = "ここまでの要約を準備中...";
    scheduleRealtimeHistoryFlush();
    return;
  }

  if (lowerType.includes("input") && lowerType.includes("completed")) {
    scheduleRealtimeHistoryFlushSoon();
    return;
  }

  if ((lowerType.includes("output") || lowerType.includes("translation") || lowerType.includes("response")) && lowerType.includes("transcript") && delta) {
    state.realtimeLastOutputAt = Date.now();
    state.realtimeTranslationBuffer += delta;
    appendRealtimeDelta(elements.translationText, delta);
    elements.translationHint.textContent = "Realtime翻訳を受信中...";
    scheduleRealtimeHistoryFlush();
    return;
  }

  if ((lowerType.includes("output") || lowerType.includes("translation") || lowerType.includes("response")) && lowerType.includes("completed")) {
    scheduleRealtimeHistoryFlushSoon();
    return;
  }

  if (event.type === "session.created") {
    elements.refineHint.textContent = "Realtime接続中";
    return;
  }

  if (event.type === "error") {
    elements.translationHint.textContent = event.error?.message || "Realtime APIエラー";
    return;
  }

  if (event.type === "session.closed" && !state.manualStop) {
    updateStatus("再接続が必要");
    elements.translationHint.textContent = "Realtimeセッションが終了しました。停止してから再度開始してください。";
  }
}

function handleRealtimeTranscriptionEvent(event) {
  if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
    state.realtimeTranscriptReceived = true;
    state.realtimeLastSourceAt = Date.now();
    clearTimeout(state.realtimeTranscriptTimer);
    state.realtimeSourceBuffer += event.delta;
    appendRealtimeDelta(elements.transcriptText, event.delta);
    elements.interimText.textContent = "Realtime文字起こし中...";
    elements.refineHint.textContent = "ここまでの要約を準備中...";
    scheduleRealtimeHistoryFlush();
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    scheduleRealtimeHistoryFlushSoon();
    return;
  }

  if (event.type === "conversation.item.input_audio_transcription.failed" || event.type === "error") {
    elements.interimText.textContent =
      event.error?.message || event.transcription_error?.message || "Realtime文字起こしでエラーが発生しました。";
  }
}

async function startRealtimeTranscription(stream) {
  const session = await createRealtimeTranscriptionSession(getLangRoot(elements.sourceLang.value));
  const clientSecret = getRealtimeClientSecret(session);
  if (!clientSecret) throw new Error("Realtime文字起こし用のclient secretを取得できませんでした。");

  const pc = new RTCPeerConnection();
  const events = pc.createDataChannel("oai-events");
  const transcriptionState = {
    pc,
    events,
    context: null,
    frameId: null,
    speechStartedAt: 0,
    lastSpeechAt: 0,
    chunkStartedAt: 0,
  };
  state.realtimeTranscription = transcriptionState;

  events.addEventListener("message", ({ data }) => {
    try {
      handleRealtimeTranscriptionEvent(JSON.parse(data));
    } catch {
      elements.interimText.textContent = "Realtime文字起こしイベントを読み取れませんでした。";
    }
  });

  events.addEventListener("open", () => {
    elements.interimText.textContent = "Realtime文字起こしを待っています...";
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    transcriptionState.context = context;

    const commit = () => {
      if (events.readyState !== "open" || !transcriptionState.speechStartedAt) return;
      events.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      transcriptionState.speechStartedAt = 0;
      transcriptionState.lastSpeechAt = 0;
      transcriptionState.chunkStartedAt = 0;
    };

    const monitor = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      const speaking = rms >= 2.2;

      if (speaking) {
        if (!transcriptionState.speechStartedAt) {
          transcriptionState.speechStartedAt = now;
          transcriptionState.chunkStartedAt = now;
        }
        transcriptionState.lastSpeechAt = now;
      }

      const chunkDuration = transcriptionState.chunkStartedAt ? now - transcriptionState.chunkStartedAt : 0;
      const silenceDuration = transcriptionState.lastSpeechAt ? now - transcriptionState.lastSpeechAt : 0;
      if (
        transcriptionState.speechStartedAt &&
        chunkDuration >= REALTIME_TRANSCRIPTION_MIN_CHUNK_MS &&
        (silenceDuration >= REALTIME_TRANSCRIPTION_SILENCE_MS ||
          chunkDuration >= REALTIME_TRANSCRIPTION_MAX_CHUNK_MS)
      ) {
        commit();
      }

      transcriptionState.frameId = requestAnimationFrame(monitor);
    };

    transcriptionState.frameId = requestAnimationFrame(monitor);
  });

  for (const track of stream.getAudioTracks()) {
    pc.addTrack(track, stream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });

  if (!sdpResponse.ok) {
    pc.close();
    throw new Error((await sdpResponse.text()) || `Realtime文字起こし接続エラー: ${sdpResponse.status}`);
  }

  await pc.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text(),
  });
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

  const stream = await getPreferredAudioStream();
  startAudioMonitor(stream);
  const activeTrack = stream.getAudioTracks()[0];
  if (activeTrack?.label) {
    const selectedLabel = getSelectedAudioLabel();
    const usingDifferentDevice =
      elements.audioInputSelect.value && selectedLabel !== "システム既定" && !activeTrack.label.includes(selectedLabel);
    const settings = activeTrack.getSettings?.() || {};
    const channelText = settings.channelCount ? ` / ${settings.channelCount}ch` : "";
    const rateText = settings.sampleRate ? ` / ${settings.sampleRate}Hz` : "";
    elements.deviceNote.textContent = usingDifferentDevice
      ? `選択: ${selectedLabel} / 実際: ${activeTrack.label}。ブラウザが別の音源を返しています。`
      : `使用中の音源: ${activeTrack.label}${channelText}${rateText}`;
  }

  const transcriptionPromise = startRealtimeTranscription(stream);
  const session = await createRealtimeSession(getRealtimeTargetLanguage(), stream);
  const clientSecret = getRealtimeClientSecret(session);
  if (!clientSecret) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Realtime client secretを取得できませんでした。");
  }

  const pc = new RTCPeerConnection();
  const events = pc.createDataChannel("oai-events");
  const translatedAudio = new Audio();
  translatedAudio.autoplay = true;
  translatedAudio.muted = true;

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
    elements.refineHint.textContent = "1分くらいの間隔で要約します。";
    elements.translationHint.textContent = "音声を待っています...";
    state.realtimeTranscriptReceived = false;
    clearTimeout(state.realtimeTranscriptTimer);
    state.realtimeTranscriptTimer = window.setTimeout(() => {
      if (!state.realtimeTranscriptReceived && state.activeCaptureMode === "realtime") {
        elements.interimText.textContent =
          "翻訳は動作していますが、Realtime原文文字起こしが届いていません。原文は翻訳より遅れる場合があります。";
      }
    }, REALTIME_TRANSCRIPT_TIMEOUT_MS);
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
  state.activeCaptureMode = "realtime";
  state.realtimeLastSourceAt = Date.now();
  state.realtimeLastOutputAt = 0;
  await transcriptionPromise;
  scheduleSummaryUpdate();
}

async function createRealtimeSession(targetLanguage, stream) {
  const payload = {
    session: {
      model: "gpt-realtime-translate",
      audio: {
        input: {
          transcription: null,
          noise_reduction: null,
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

async function createRealtimeTranscriptionSession(sourceLanguage) {
  const payload = {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "gpt-realtime-whisper",
            language: sourceLanguage,
            delay: "low",
          },
          noise_reduction: null,
        },
      },
    },
  };

  if (useBrowserApiKey()) {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getBrowserApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `Realtime文字起こしセッション作成エラー: ${response.status}`);
    }
    return data;
  }

  const response = await fetch("/realtime-transcription/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceLanguage }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Realtime文字起こしセッション作成エラー: ${response.status}`);
  }
  return data;
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

  if (mode === "openai" || mode === "realtime") {
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
  elements.translationHint.textContent = "翻訳中...";

  let translated = "";
  try {
    translated = await translateText(cleanText);
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
    translation: translated,
  };
  state.segments.push(segment);
  renderHistoryItem(segment);
}

function scheduleBufferedTranscript(text) {
  const cleanText = text.trim();
  if (!cleanText) return;

  if (!state.pendingStartedAt) {
    state.pendingStartedAt = Date.now();
  }

  state.pendingTranscript.push(cleanText);
  clearTimeout(state.flushTimer);

  const bufferedText = state.pendingTranscript.join(" ");
  const bufferedStats = getSegmentStats(bufferedText);

  if (Date.now() - state.pendingStartedAt >= MAX_BUFFER_MS && bufferedStats.words >= HISTORY_MIN_WORDS) {
    flushBufferedTranscript();
    return;
  }

  if (looksLikeSentenceEnd(bufferedText) && bufferedStats.words >= HISTORY_MIN_WORDS) {
    elements.refineHint.textContent = "要約用の文字起こしを蓄積中...";
    state.flushTimer = window.setTimeout(flushBufferedTranscript, SENTENCE_END_DELAY_MS);
    return;
  }

  elements.refineHint.textContent = "要約用の文字起こしを蓄積中...";
  state.flushTimer = window.setTimeout(flushBufferedTranscript, SILENCE_DELAY_MS);
}

function flushBufferedTranscript() {
  clearTimeout(state.flushTimer);
  const text = state.pendingTranscript.join(" ").trim();
  state.pendingTranscript = [];
  state.pendingStartedAt = 0;
  if (!text) return;

  enqueueProcessing(() => handleFinalTranscript(text));
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
    state.activeCaptureMode = "speech";
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    updateStatus("録音中", true);
    elements.refineHint.textContent = "1分くらいの間隔で要約します。";
    scheduleSummaryUpdate();
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
    if (state.activeCaptureMode === "speech") {
      state.activeCaptureMode = "";
    }
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
  if (useBrowserApiKey() && !getBrowserApiKey()) {
    promptAndSaveBrowserApiKey();
    updateStatus("APIキーが必要");
    return;
  }
  if (isRealtimeMode()) {
    startRealtimeTranslation().catch((error) => {
      cleanupRealtime();
      state.listening = false;
      elements.startBtn.disabled = false;
      elements.stopBtn.disabled = true;
      updateStatus("確認が必要");
      const message = formatAudioError(error);
      elements.translationHint.textContent = message;
      elements.deviceNote.textContent = message;
    });
    return;
  }
  if (elements.translatorMode.value === "openai") {
    startOpenAIAudioTranscription().catch((error) => {
      cleanupOpenAIAudio();
      state.listening = false;
      elements.startBtn.disabled = false;
      elements.stopBtn.disabled = true;
      updateStatus("確認が必要");
      const message = formatAudioError(error);
      elements.interimText.textContent = message;
      elements.deviceNote.textContent = message;
    });
    return;
  }
  state.recognition = setupRecognition();
  state.recognition?.start();
}

function stopListening() {
  state.manualStop = true;
  if (state.activeCaptureMode === "realtime" || state.realtime) {
    cleanupRealtime();
    state.listening = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    updateStatus("待機中");
    enqueueFinalSummaryAfterStop();
    showPendingProcessingAfterStop();
    return;
  }
  if (state.activeCaptureMode === "openai-audio" || state.openaiAudio) {
    state.listening = false;
    cleanupOpenAIAudio();
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    updateStatus("待機中");
    elements.interimText.textContent = "";
    enqueueFinalSummaryAfterStop();
    showPendingProcessingAfterStop();
    return;
  }
  flushBufferedTranscript();
  state.recognition?.stop();
  enqueueFinalSummaryAfterStop();
  showPendingProcessingAfterStop();
}

function stopForEngineChange() {
  if (!state.listening && !state.realtime) return;
  stopListening();
  updateStatus("再開始が必要");
  elements.interimText.textContent = "";
  elements.translationHint.textContent = isRealtimeMode()
    ? "翻訳エンジンを変更しました。もう一度「開始」を押してください。"
    : "翻訳エンジンを変更しました。もう一度「開始」を押してください。";
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
    .map((segment) => `[${segment.time}]\n文字起こし: ${segment.original || ""}\n訳文: ${segment.translation || ""}`)
    .join("\n\n");
}

function buildRecordingText() {
  const transcript = elements.transcriptText.value.trim() || state.transcript.join("\n");
  const translation = elements.translationText.value.trim();
  const summary = state.summaryText.trim();
  const pairedHistory = buildExportText();
  const sections = [
    ["文字起こし", transcript],
    ["日本語訳", translation],
    ["要約", summary],
    ["対訳", pairedHistory],
  ];

  return sections
    .filter(([, content]) => content?.trim())
    .map(([title, content]) => `# ${title}\n${content.trim()}`)
    .join("\n\n");
}

async function copyRecording() {
  await copyText(buildRecordingText());
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
  state.translations = [];
  state.segments = [];
  state.pendingTranscript = [];
  state.pendingStartedAt = 0;
  state.realtimeSourceBuffer = "";
  state.realtimeTranslationBuffer = "";
  state.realtimeBufferStartedAt = 0;
  state.summaryText = "";
  state.summaries = [];
  state.lastSummarySegmentCount = 0;
  clearTimeout(state.flushTimer);
  clearTimeout(state.realtimeHistoryTimer);
  clearTimeout(state.summaryTimer);
  cleanupRealtime();
  cleanupOpenAIAudio();
  elements.transcriptText.value = "";
  elements.refinedText.value = "";
  elements.translationText.value = "";
  if (elements.refinedTranslationText) {
    elements.refinedTranslationText.value = "";
  }
  elements.historyList.replaceChildren();
  elements.interimText.textContent = "";
  elements.refineHint.textContent = "ここまでの要約が表示されます。";
  elements.translationHint.textContent = "翻訳結果がここに表示されます。";
}

elements.startBtn.addEventListener("click", startListening);
elements.stopBtn.addEventListener("click", stopListening);
elements.translateInputBtn.addEventListener("click", translateTypedInput);
elements.copyTranscriptBtn.addEventListener("click", () => copyText(elements.transcriptText.value));
elements.copyRefinedBtn.addEventListener("click", () => copyText(elements.refinedText.value));
elements.copyTranslationBtn.addEventListener("click", () => copyText(elements.translationText.value));
elements.copyRefinedTranslationBtn?.addEventListener("click", () => copyText(elements.refinedTranslationText.value));
elements.copyAllBtn.addEventListener("click", copyRecording);
elements.copyBtn.addEventListener("click", copyHistory);
elements.downloadBtn.addEventListener("click", downloadHistory);
elements.clearBtn.addEventListener("click", clearHistory);
elements.refreshDevicesBtn.addEventListener("click", () => refreshAudioInputs({ requestPermission: true }));
elements.audioInputSelect.addEventListener("change", () => {
  state.audioInputTouched = true;
  const selectedLabel = elements.audioInputSelect.selectedOptions[0]?.textContent || "システム既定";
  elements.deviceNote.textContent = state.listening
    ? `次回開始時の音源: ${selectedLabel}。反映するには一度停止して開始してください。`
    : `現在の音源: ${selectedLabel}`;
  saveSettings();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => refreshAudioInputs());
}

for (const control of [elements.sourceLang, elements.targetLang, elements.libreEndpoint, elements.libreKey]) {
  control.addEventListener("change", () => {
    toggleLibreSettings();
    toggleApiSettings();
    updateBadges();
    saveSettings();
  });
}

elements.translatorMode.addEventListener("change", () => {
  stopForEngineChange();
  toggleLibreSettings();
  toggleApiSettings();
  updateBadges();
  saveSettings();
});

elements.apiMode.addEventListener("change", () => {
  toggleApiSettings();
  saveSettings();
});
elements.showBrowserKeyBtn.addEventListener("click", () => {
  elements.apiMode.value = "browser";
  toggleApiSettings();
  saveSettings();
  promptAndSaveBrowserApiKey();
});
elements.cancelApiKeyBtn.addEventListener("click", () => elements.apiKeyDialog.close());
elements.confirmApiKeyBtn.addEventListener("click", saveDialogApiKey);
elements.dialogApiKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveDialogApiKey();
  }
});
elements.saveBrowserKeyBtn.addEventListener("click", saveBrowserApiKey);
elements.clearBrowserKeyBtn.addEventListener("click", clearBrowserApiKey);

loadSettings();
setupRecognition();
refreshAudioInputs();
