const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";

loadEnvFile();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fsSync.existsSync(envPath)) return;

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readBuffer(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function translate({ text, source, target }) {
  if (!text || !source || !target) {
    throw new Error("翻訳するテキストと言語を指定してください。");
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`翻訳サービスに接続できませんでした (${response.status})。`);
  }

  const data = await response.json();
  return Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || "").join("") : "";
}

async function translateWithOpenAI({ text, source, target }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません。");
  }
  if (!text || !source || !target) {
    throw new Error("翻訳するテキストと言語を指定してください。");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini",
      input: [
        {
          role: "system",
          content: `Translate from ${source} to ${target}. Return only the translated text.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  }

  if (typeof data.output_text === "string") return data.output_text.trim();

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
      .trim() || ""
  );
}

async function transcribeWithOpenAI({ audioBuffer, mimeType, source }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません。");
  }
  if (!audioBuffer?.length) {
    throw new Error("文字起こしする音声がありません。");
  }

  const form = new FormData();
  const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
  form.append("file", new Blob([audioBuffer], { type: mimeType || "audio/webm" }), `audio.${extension}`);
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  if (source && source !== "auto") {
    form.append("language", source.split("-")[0]);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI transcription error (${response.status})`);
  }

  return data.text || "";
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

async function refineTranscript({ text, source }) {
  if (!text || !source) {
    throw new Error("補正するテキストと言語を指定してください。");
  }
  if (!process.env.OPENAI_API_KEY) {
    return basicRefineText(text);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_REFINEMENT_MODEL || process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            `You clean up live meeting transcripts in ${source}.`,
            "Fix obvious speech recognition errors, punctuation, casing, spacing, and duplicated filler.",
            "Preserve meaning, speaker intent, names, numbers, and technical terms.",
            "Do not summarize. Return only the corrected text.",
          ].join(" "),
        },
        {
          role: "user",
          content: text,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  }

  if (typeof data.output_text === "string") return data.output_text.trim();

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
      .trim() || basicRefineText(text)
  );
}

async function reviseContext({ segments, source, target }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("再補正する文を指定してください。");
  }
  if (!process.env.OPENAI_API_KEY) {
    return segments;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_REFINEMENT_MODEL || process.env.OPENAI_TRANSLATION_MODEL || "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            `You revise recent meeting transcript segments using nearby context.`,
            `Source language: ${source}. Target language: ${target}.`,
            "For each segment, improve only obvious context-dependent transcription mistakes, punctuation, and capitalization.",
            "Then translate that corrected source text into the target language.",
            "Use the source/refined text as the authority. Do not invent missing sentences and do not use prior translations as the source.",
            "Preserve the number and order of segments. Do not merge or summarize.",
            "Return valid JSON only: {\"segments\":[{\"refined\":\"...\",\"translation\":\"...\"}]}",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ segments }),
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
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${response.status})`);
  }

  const outputText =
    typeof data.output_text === "string"
      ? data.output_text
      : data.output
          ?.flatMap((item) => item.content || [])
          .map((content) => content.text || "")
          .join("") || "";

  const parsed = JSON.parse(outputText);
  return Array.isArray(parsed.segments) ? parsed.segments : segments;
}

function normalizeRealtimeTargetLanguage(language) {
  const allowed = new Set(["es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it", "en"]);
  return allowed.has(language) ? language : "ja";
}

async function createRealtimeTranslationSession({ targetLanguage }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません。");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        model: process.env.OPENAI_REALTIME_TRANSLATION_MODEL || "gpt-realtime-translate",
        audio: {
          input: {
            transcription: { model: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" },
          },
          output: {
            language: normalizeRealtimeTargetLanguage(targetLanguage),
          },
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI Realtime error (${response.status})`);
  }

  return data;
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const safePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const ext = path.extname(filePath);
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/translate") {
      const body = await readJson(request);
      const translatedText = await translate(body);
      sendJson(response, 200, { translatedText });
      return;
    }

    if (request.method === "POST" && request.url === "/translate/openai") {
      const body = await readJson(request);
      const translatedText = await translateWithOpenAI(body);
      sendJson(response, 200, { translatedText });
      return;
    }

    if (request.method === "POST" && request.url.startsWith("/transcribe/openai")) {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const audioBuffer = await readBuffer(request);
      const transcriptText = await transcribeWithOpenAI({
        audioBuffer,
        mimeType: request.headers["content-type"] || "audio/webm",
        source: requestUrl.searchParams.get("source") || "auto",
      });
      sendJson(response, 200, { transcriptText });
      return;
    }

    if (request.method === "POST" && request.url === "/refine") {
      const body = await readJson(request);
      const refinedText = await refineTranscript(body);
      sendJson(response, 200, { refinedText });
      return;
    }

    if (request.method === "POST" && request.url === "/revise-context") {
      const body = await readJson(request);
      const segments = await reviseContext(body);
      sendJson(response, 200, { segments });
      return;
    }

    if (request.method === "POST" && request.url === "/realtime-translation/session") {
      const body = await readJson(request);
      const session = await createRealtimeTranslationSession(body);
      sendJson(response, 200, session);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error.message || "翻訳に失敗しました。" });
  }
});

server.listen(port, host, () => {
  console.log(`Live Meeting Translator: http://localhost:${port}`);
});
