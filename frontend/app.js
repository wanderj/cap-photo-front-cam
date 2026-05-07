const API_BASE_URL = "";
const PERMISSION_TIMEOUT_MS = 15000;
const MAX_CAPTURES = 5;
const CAPTURE_INTERVAL_MS = 5000;

const elements = {
  captureVideo: document.getElementById("captureVideo"),
  status: document.getElementById("status"),
};

let stream = null;
let timerId = null;
let captureCount = 0;
let isSequenceActive = false;
let isCaptureInProgress = false;
let hasInitialized = false;

function setStatus(message, level = "info") {
  elements.status.textContent = message;
  elements.status.classList.remove("error", "warn");
  if (level === "error" || level === "warn") {
    elements.status.classList.add(level);
  }
}

function buildCameraErrorMessage(error) {
  if (!error) {
    return "Falha desconhecida ao acessar a camera.";
  }

  if (error.name === "NotAllowedError") {
    return "Permissao negada para uso da camera.";
  }

  if (error.name === "TimeoutError") {
    return "Tempo limite excedido para decisao de permissao de camera.";
  }

  if (error.name === "NotFoundError" || error.name === "NotReadableError") {
    return "Falha no dispositivo de camera. Verifique disponibilidade da camera frontal.";
  }

  return "Nao foi possivel iniciar a camera no dispositivo.";
}

function getUserMediaWithTimeout(constraints, timeoutMs) {
  const timeoutPromise = new Promise((_, reject) => {
    const timeoutError = new Error("Camera permission timeout");
    timeoutError.name = "TimeoutError";
    setTimeout(() => reject(timeoutError), timeoutMs);
  });

  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    timeoutPromise,
  ]);
}

function stopCamera(reason = "finished") {
  console.log("encerrando camera", { reason });

  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }

  isSequenceActive = false;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  elements.captureVideo.srcObject = null;
}

async function initCamera() {
  if (hasInitialized || isSequenceActive) {
    return;
  }

  hasInitialized = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Este navegador nao suporta getUserMedia.", "error");
    return;
  }

  setStatus("Solicitando permissao de camera...");

  try {
    stream = await getUserMediaWithTimeout(
      {
        video: { facingMode: "user" },
        audio: false,
      },
      PERMISSION_TIMEOUT_MS,
    );

    setStatus("Permissao concedida. Iniciando sequencia de capturas...");
    startCaptureSequence();
  } catch (error) {
    console.error("Falha ao inicializar camera", error);
    stopCamera("init_error");
    setStatus(buildCameraErrorMessage(error), "error");
  }
}

function startCaptureSequence() {
  if (!stream || isSequenceActive) {
    return;
  }

  captureCount = 0;
  isSequenceActive = true;

  const runCapture = async () => {
    if (!isSequenceActive || isCaptureInProgress) {
      return;
    }

    if (captureCount >= MAX_CAPTURES) {
      stopCamera("completed");
      setStatus("Sequencia finalizada com sucesso.");
      return;
    }

    console.log("captura iniciada", { index: captureCount + 1, total: MAX_CAPTURES });
    setStatus(`Capturando imagem ${captureCount + 1} de ${MAX_CAPTURES}...`);
    isCaptureInProgress = true;

    try {
      const imageBlob = await captureFrame();
      captureCount += 1;
      console.log(`imagem ${captureCount} capturada`);

      await sendImage(imageBlob, captureCount);
      console.log("envio realizado", { index: captureCount });

      if (captureCount >= MAX_CAPTURES) {
        stopCamera("completed");
        setStatus("Sequencia finalizada com sucesso.");
        return;
      }

      setStatus(
        `Imagem ${captureCount}/${MAX_CAPTURES} enviada. Proxima captura em ${
          CAPTURE_INTERVAL_MS / 1000
        }s...`,
      );
      timerId = setTimeout(() => {
        void runCapture();
      }, CAPTURE_INTERVAL_MS);
    } catch (error) {
      console.error("Falha durante sequencia de captura", error);
      stopCamera("sequence_error");
      setStatus("Falha na captura ou envio. Fluxo encerrado com seguranca.", "error");
    } finally {
      isCaptureInProgress = false;
    }
  };

  void runCapture();
}

async function captureFrame() {
  if (!stream) {
    throw new Error("Capture called without active stream");
  }

  const videoElement = elements.captureVideo;
  videoElement.srcObject = stream;
  await videoElement.play();

  if (videoElement.readyState < 2) {
    await new Promise((resolve) => {
      videoElement.addEventListener("loadeddata", resolve, { once: true });
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = videoElement.videoWidth || 640;
  canvas.height = videoElement.videoHeight || 480;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0 || blob.type !== "image/jpeg") {
          reject(new Error("Falha ao capturar imagem."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.9,
    );
  });
}

async function sendImage(capturedBlob, imageIndex) {
  setStatus(`Enviando imagem ${imageIndex} para o backend...`);

  const formData = new FormData();
  formData.append("image", capturedBlob, `capture_${imageIndex}.jpg`);
  formData.append("user_agent", navigator.userAgent || "");

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload && payload.detail ? payload.detail : "Erro de upload.";
    throw new Error(detail);
  }

  setStatus(
    `Envio realizado (${imageIndex}/${MAX_CAPTURES}). Arquivo: ${payload.filename || "n/a"}`,
  );
}

document.addEventListener("DOMContentLoaded", () => {
  void initCamera();
});
