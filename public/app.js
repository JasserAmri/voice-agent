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

// Speech Synthesis — pick the best available voice
const synth = window.speechSynthesis;
let bestVoice = null;

// Preferred voices ranked by natural quality (best first)
const PREFERRED_VOICES = [
  "Microsoft Jenny",    // Windows 11 neural voice (very natural)
  "Microsoft Aria",     // Windows 11 neural voice
  "Microsoft Guy",      // Windows 11 neural voice
  "Microsoft Zira",     // Windows decent quality
  "Google UK English Female",
  "Google UK English Male",
  "Google US English",
  "Samantha",           // macOS natural voice
  "Karen",              // macOS natural voice
  "Daniel",             // macOS natural voice
];

function pickBestVoice() {
  const voices = synth.getVoices();
  if (voices.length === 0) return;

  // Try preferred voices first
  for (const pref of PREFERRED_VOICES) {
    const match = voices.find(v => v.name.includes(pref));
    if (match) {
      bestVoice = match;
      console.log("[TTS] Selected voice:", match.name, match.lang);
      return;
    }
  }

  // Fallback: pick first English voice that isn't "default"
  const english = voices.find(v => v.lang.startsWith("en") && !v.name.includes("default"));
  if (english) {
    bestVoice = english;
    console.log("[TTS] Fallback voice:", english.name, english.lang);
    return;
  }

  console.log("[TTS] Using default system voice");
}

// Voices load async in some browsers
synth.onvoiceschanged = pickBestVoice;
pickBestVoice();

function speak(text) {
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (bestVoice) utterance.voice = bestVoice;
  utterance.rate = 0.95;   // Slightly slower for clarity
  utterance.pitch = 1.05;  // Slightly higher for warmth

  micBtn.disabled = true;
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
  synth.cancel();
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
    micBtn.disabled = false;
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
