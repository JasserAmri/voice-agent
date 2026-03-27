// Session ID for conversation continuity
const SESSION_ID = crypto.randomUUID();

// DOM elements
const chat = document.getElementById("chat");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const statusBadge = document.getElementById("statusBadge");

// Speech Recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    stopListening();
    sendMessage(transcript);
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    stopListening();
    if (event.error === "not-allowed") {
      addSystemMessage("Microphone access denied. Please allow mic access and reload.");
    }
  };

  recognition.onend = () => {
    if (isListening) stopListening();
  };

  micBtn.disabled = false;
  micBtn.textContent = "Mic";
  statusBadge.textContent = "Ready";
  statusBadge.className = "status connected";
} else {
  micBtn.disabled = true;
  micBtn.textContent = "No Mic";
  statusBadge.textContent = "No Speech API (use Chrome)";
  statusBadge.className = "status error";
  addSystemMessage("Speech recognition not supported. Use Chrome/Edge, or type below.");
}

// TTS — use ElevenLabs server-side, fallback to browser speech synthesis
let useElevenLabs = true; // will be set to false if first call fails
let currentAudio = null;

async function speak(text) {
  // Stop any playing audio
  stopSpeaking();

  micBtn.disabled = true;

  if (useElevenLabs) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      currentAudio.onended = () => {
        micBtn.disabled = false;
        URL.revokeObjectURL(url);
        currentAudio = null;
      };
      currentAudio.onerror = () => {
        micBtn.disabled = false;
        URL.revokeObjectURL(url);
        currentAudio = null;
      };
      currentAudio.play();
      return;
    } catch (err) {
      console.warn("[TTS] ElevenLabs failed, falling back to browser:", err.message);
      useElevenLabs = false;
    }
  }

  // Fallback: browser speech synthesis
  speakBrowser(text);
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  synth.cancel();
}

// Browser speech synthesis fallback
const synth = window.speechSynthesis;
let bestVoice = null;

const PREFERRED_VOICES = [
  "Microsoft Jenny",
  "Microsoft Aria",
  "Microsoft Guy",
  "Microsoft Zira",
  "Google UK English Female",
  "Google UK English Male",
  "Google US English",
  "Samantha",
  "Karen",
  "Daniel",
];

function pickBestVoice() {
  const voices = synth.getVoices();
  if (voices.length === 0) return;
  for (const pref of PREFERRED_VOICES) {
    const match = voices.find(v => v.name.includes(pref));
    if (match) {
      bestVoice = match;
      console.log("[TTS] Browser fallback voice:", match.name);
      return;
    }
  }
  const english = voices.find(v => v.lang.startsWith("en") && !v.name.includes("default"));
  if (english) bestVoice = english;
}

synth.onvoiceschanged = pickBestVoice;
pickBestVoice();

function speakBrowser(text) {
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (bestVoice) utterance.voice = bestVoice;
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.onend = () => { micBtn.disabled = false; };
  utterance.onerror = () => { micBtn.disabled = false; };
  synth.speak(utterance);
}

// Listening controls
function startListening() {
  if (!recognition || isListening) return;
  isListening = true;
  micBtn.classList.add("listening");
  micBtn.textContent = "Listening...";
  statusBadge.textContent = "Listening...";
  stopSpeaking();
  recognition.start();
}

function stopListening() {
  if (!isListening) return;
  isListening = false;
  micBtn.classList.remove("listening");
  micBtn.textContent = "Mic";
  statusBadge.textContent = "Ready";
  statusBadge.className = "status connected";
  try { recognition.stop(); } catch {}
}

// UI helpers
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function addSystemMessage(text) {
  addMessage("system", text);
}

function showThinking() {
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.id = "thinking";
  const container = document.createElement("div");
  container.className = "thinking";
  for (let i = 0; i < 3; i++) {
    container.appendChild(document.createElement("span"));
  }
  div.appendChild(container);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function removeThinking() {
  const el = document.getElementById("thinking");
  if (el) el.remove();
}

// Send message to backend
async function sendMessage(text) {
  if (!text.trim()) return;

  addMessage("user", text);
  textInput.value = "";
  showThinking();

  sendBtn.disabled = true;
  micBtn.disabled = true;
  statusBadge.textContent = "Processing...";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": SESSION_ID,
      },
      body: JSON.stringify({ text }),
    });

    removeThinking();

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      addSystemMessage("Error: " + (err.error || res.statusText));
      return;
    }

    const data = await res.json();
    addMessage("assistant", data.reply);
    speak(data.reply);
  } catch (err) {
    removeThinking();
    addSystemMessage("Connection error: " + err.message);
  } finally {
    sendBtn.disabled = false;
    if (!currentAudio) micBtn.disabled = false;
    statusBadge.textContent = "Ready";
    statusBadge.className = "status connected";
  }
}

// Event listeners
micBtn.addEventListener("click", () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

sendBtn.addEventListener("click", () => {
  sendMessage(textInput.value);
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(textInput.value);
  }
});

// Initial greeting
addSystemMessage("Hello! Click the mic button or type a message to start chatting.");
