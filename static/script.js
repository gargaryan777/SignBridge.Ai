// ===============================
// GLOBAL VARIABLES
// ===============================

let sentence = "";
let lastWord = "";
let lastPredictTime = 0;
let localStream;
let currentRoom = null;
let peerConnection = null;
let socket = null;
let isMicOn = true;
let isCamOn = true;
let isMLOn = true;
let isSpeechOn = false;
let isChatSpeechOn = false;
let recognition = null;
let chatRecognition = null;
let gestureCount = 0;
const PREDICTION_INTERVAL_MS = 400;

// ===============================
// TOAST NOTIFICATIONS
// ===============================
function showToast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");

canvasElement.width = 480;
canvasElement.height = 360;

const config = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302"] }
    ]
};

// Initialize Socket immediately to show connection status
socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true
});

socket.on('connect', () => {
    console.log("Connected to signaling server");
    updateConnectionUI(true);
});

socket.on('disconnect', () => {
    updateConnectionUI(false);
});

// ===============================
// INITIALIZATION
// ===============================

async function startVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = localStream;

        const hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 0,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.6
        });

        hands.onResults(onResults);

        const camera = new Camera(localVideo, {
            onFrame: async () => {
                await hands.send({ image: localVideo });
            },
            width: 480,
            height: 360
        });

        camera.start();
        initSpeechRecognition();
        updateAuthUI();

    } catch (err) {
        console.error("Camera error:", err);
        showToast("⚠️ Camera permission denied. Please allow access.");
    }
}

startVideo();

// ===============================
// MEDIAPIPE + PREDICTION
// ===============================

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, 640, 480);

    // We only draw landmark connections for clarity
    if (results.multiHandLandmarks) {
        const sortedHands = results.multiHandLandmarks.sort((a, b) => a[0].x - b[0].x);
        let frameData = [];

        for (const landmarks of sortedHands) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#6366f1', lineWidth: 2 });
            drawLandmarks(canvasCtx, landmarks, { color: '#ffffff', lineWidth: 1, radius: 2 });

            for (let i = 0; i < landmarks.length; i++) {
                frameData.push(landmarks[i].x, landmarks[i].y, landmarks[i].z);
            }
        }

        while (frameData.length < 126) frameData.push(0);

        if (!isMLOn) {
            canvasCtx.restore();
            return;
        }

        const now = Date.now();
        if (now - lastPredictTime < PREDICTION_INTERVAL_MS) {
            canvasCtx.restore();
            return;
        }
        lastPredictTime = now;

        fetch("/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ landmarks: frameData })
        })
            .then(res => res.json())
            .then(data => {
                const predictionBox = document.getElementById("predictionText");
                const subtitle = document.getElementById("subtitleOverlay");
                const confBar = document.getElementById("confidenceBar");

                if (data.prediction === "Uncertain") {
                    predictionBox.innerText = "Detecting...";
                    subtitle.innerText = "Waiting for clear gesture";
                    confBar.style.width = "0%";
                    return;
                }

                const currentWord = data.prediction;
                const confPercent = (data.confidence * 100).toFixed(0);

                predictionBox.innerText = currentWord;
                subtitle.innerText = `${confPercent}% confidence`;
                confBar.style.width = `${confPercent}%`;

                // Visual pulse on subtitle box
                const subtitleBox = document.getElementById('subtitleBox');
                if (subtitleBox) {
                    subtitleBox.classList.add('pulse');
                    setTimeout(() => subtitleBox.classList.remove('pulse'), 400);
                }

                // Glow effect on video card
                const localCard = document.getElementById('localCard');
                if (localCard) localCard.classList.add('detecting');

                if (currentWord !== lastWord && data.confidence > 0.6) {
                    if (currentWord.length === 1 && lastWord.length === 1) {
                        sentence = sentence.trim() + currentWord + " ";
                    } else {
                        sentence += currentWord + " ";
                    }
                    lastWord = currentWord;
                    document.getElementById("sentenceBox").innerText = sentence;

                    // Update gesture counter
                    gestureCount++;
                    const countEl = document.getElementById('gestureCount');
                    if (countEl) countEl.textContent = gestureCount;
                }
            })
            .catch(err => console.error("Predict error:", err));
    } else {
        document.getElementById("confidenceBar").style.width = "0%";
        const localCard = document.getElementById('localCard');
        if (localCard) localCard.classList.remove('detecting');
    }

    canvasCtx.restore();
}

// ===============================
// CORE CONTROLS
// ===============================

function toggleMic() {
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach(track => track.enabled = isMicOn);

    const btn = document.getElementById("micBtn");
    btn.classList.toggle("btn-off", !isMicOn);
    btn.innerHTML = isMicOn ? '<i data-lucide="mic"></i>' : '<i data-lucide="mic-off"></i>';
    lucide.createIcons();
}

function toggleCamera() {
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(track => track.enabled = isCamOn);

    const btn = document.getElementById("camBtn");
    btn.classList.toggle("btn-off", !isCamOn);
    btn.innerHTML = isCamOn ? '<i data-lucide="video"></i>' : '<i data-lucide="video-off"></i>';
    lucide.createIcons();
}

function toggleML() {
    isMLOn = !isMLOn;
    const btn = document.getElementById("mlBtn");
    btn.classList.toggle("btn-off", !isMLOn);
    btn.innerHTML = isMLOn ? '<i data-lucide="brain"></i>' : '<i data-lucide="brain-cog"></i>';
    lucide.createIcons();

    const predictionBox = document.getElementById("predictionText");
    const subtitle = document.getElementById("subtitleOverlay");
    const confBar = document.getElementById("confidenceBar");
    if (!isMLOn) {
        predictionBox.innerText = "ML Paused";
        subtitle.innerText = "Prediction disabled";
        confBar.style.width = "0%";
    } else {
        predictionBox.innerText = "Detecting...";
        subtitle.innerText = "Waiting for gesture...";
    }
}

function clearSentence() {
    sentence = "";
    lastWord = "";
    document.getElementById("sentenceBox").innerText = "Waiting for results...";
}

// Preload voices (browsers load them asynchronously)
let cachedVoices = [];
function loadVoices() {
    cachedVoices = window.speechSynthesis.getVoices();
}
window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function getBestVoice() {
    const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Prioritize Indian English voices (macOS & Chrome)
    const preferred = [
        'Rishi',          // macOS Indian male
        'Veena',          // macOS Indian female
        'Google UK English Female', // Good clear fallback
        'Samantha'        // clear fallback
    ];

    // Try finding exact Indian accent preference
    for (const name of preferred) {
        const match = voices.find(v => v.name.includes(name) || (v.lang === 'en-IN'));
        if (match) return match;
    }

    // Fallback: any en-IN voice, or just en voice
    return voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang.startsWith('en')) || voices[0];
}

async function speakSentence() {
    const text = document.getElementById("sentenceBox").innerText;
    if (!text || text === "Waiting for results..." || text === "ML Paused") return;

    // Stop any currently playing local speech
    window.speechSynthesis.cancel();

    // Try ElevenLabs via backend
    try {
        const response = await fetch("/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);

            // Slow down the ElevenLabs voice slightly
            audio.playbackRate = 0.85;
            audio.preservesPitch = true;

            audio.play();
            return;
        } else {
            const errData = await response.json().catch(() => ({}));
            if (errData.error && errData.error.includes("ELEVENLABS_API_KEY")) {
                console.warn("ElevenLabs API key missing, falling back to local TTS");
            } else {
                console.error("ElevenLabs error:", errData);
            }
        }
    } catch (e) {
        console.error("Fetch error calling /speak:", e);
    }

    // Fallback: Local Browser TTS
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getBestVoice();
    if (voice) utterance.voice = voice;

    // Slower pacing for better comprehension
    utterance.rate = 0.82;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
}

// ===============================
// SPEECH RECOGNITION (VOICE TO TEXT)
// ===============================

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error("Speech Recognition not supported");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                sentence += event.results[i][0].transcript + " ";
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        document.getElementById("sentenceBox").innerText = sentence + (interimTranscript ? ` (${interimTranscript})` : "");
    };

    recognition.onerror = (event) => console.error("Speech recognition error:", event.error);
    recognition.onend = () => { if (isSpeechOn) recognition.start(); };
}

function toggleSpeech() {
    if (!recognition) return;
    isSpeechOn = !isSpeechOn;

    const btn = document.getElementById("voiceBtn");
    btn.classList.toggle("btn-primary", isSpeechOn);
    btn.classList.toggle("btn-secondary", !isSpeechOn);

    if (isSpeechOn) {
        recognition.start();
        document.getElementById("sentenceBox").innerText = "Listening...";
    } else {
        recognition.stop();
    }
}

// ===============================
// WEBRTC SIGNALING (via SocketIO)
// ===============================

function generateRoomCode() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    document.getElementById("roomInput").value = code;
}

function copyRoomCode() {
    const code = document.getElementById("roomInput").value;
    if (!code) return;
    navigator.clipboard.writeText(code);
    showToast("✅ Room code copied: " + code);
}

function copyTranscript() {
    const text = document.getElementById("sentenceBox").innerText;
    if (!text || text === "Waiting for results...") return;
    navigator.clipboard.writeText(text);
    showToast("📋 Transcript copied!");
}

function unlockRemoteVideo() {
    document.getElementById("remoteOverlay").style.display = "none";
    remoteVideo.muted = false;
    remoteVideo.play();
}

async function joinRoom() {
    const room = document.getElementById("roomInput").value.trim();
    if (!room) return showToast("⚠️ Please enter a room code");

    // Re-use existing socket if possible, otherwise reconnect
    if (!socket || !socket.connected) {
        socket = io({
            transports: ['polling', 'websocket'],
            upgrade: true
        });
    }

    // Clear previous room listeners
    socket.off('role');
    socket.off('peer_joined');
    socket.off('signal');

    socket.emit('join_room', { room });
    currentRoom = room;

    updateConnectionUI(true, room);

    let isInitiator = false;
    let candidateQueue = [];

    socket.on('role', (data) => {
        isInitiator = data.initiator;
        createPeer(room);
    });

    socket.on('peer_joined', async () => {
        if (isInitiator) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { type: "offer", offer, room });
        }
    });

    socket.on('signal', async (data) => {
        if (data.type === "offer") {
            createPeer(room);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            candidateQueue.forEach(c => peerConnection.addIceCandidate(new RTCIceCandidate(c)));
            candidateQueue = [];
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { type: "answer", answer, room });
        }

        if (data.type === "answer") {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            candidateQueue.forEach(c => peerConnection.addIceCandidate(new RTCIceCandidate(c)));
            candidateQueue = [];
        }

        if (data.type === "candidate") {
            const cand = new RTCIceCandidate(data.candidate);
            if (peerConnection && peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(cand);
            } else {
                candidateQueue.push(data.candidate);
            }
        }

        if (data.type === "chat") {
            appendChatMessage(data.message, "Remote");
        }

        if (data.type === "leave") {
            handlePeerLeave();
        }
    });
}

function createPeer(room) {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(config);

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.muted = true;
        remoteVideo.play().then(() => {
            document.getElementById("remoteOverlay").style.display = "none";
            remoteVideo.muted = false;
        }).catch(() => {
            document.getElementById("remoteOverlay").style.display = "flex";
        });
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { type: "candidate", candidate: event.candidate, room });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected') {
            handlePeerLeave();
        }
    };
}

function leaveRoom() {
    if (socket) {
        socket.emit('signal', { type: "leave", room: currentRoom });
        socket.disconnect();
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteVideo.srcObject = null;
    document.getElementById("remoteOverlay").style.display = "flex";
    updateConnectionUI(false);
    currentRoom = null;
}

function handlePeerLeave() {
    remoteVideo.srcObject = null;
    document.getElementById("remoteOverlay").style.display = "flex";
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // Re-create peer to wait for next connection
    if (currentRoom) createPeer(currentRoom);
}

function updateConnectionUI(connected, room = "") {
    const status = document.getElementById("connectionStatus");
    const joinBtn = document.getElementById("joinBtn");
    const leaveBtn = document.getElementById("leaveBtn");

    if (connected) {
        status.innerText = "In Room: " + room;
        status.style.color = "#10b981";
        status.style.borderColor = "rgba(16, 185, 129, 0.2)";
        status.style.background = "rgba(16, 185, 129, 0.1)";
        joinBtn.style.display = "none";
        leaveBtn.style.display = "inline-flex";
    } else {
        status.innerText = "Disconnected";
        status.style.color = "#ef4444";
        status.style.borderColor = "rgba(239, 68, 68, 0.2)";
        status.style.background = "rgba(239, 68, 68, 0.1)";
        joinBtn.style.display = "inline-flex";
        leaveBtn.style.display = "none";
    }
}

// ===============================
// CHAT FUNCTIONALITY
// ===============================

function handleChatKey(e) {
    if (e.key === 'Enter') sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg) return;

    if (socket && currentRoom) {
        socket.emit('signal', { type: "chat", message: msg, room: currentRoom });
    }

    appendChatMessage(msg, "You");
    input.value = "";

    // Auto turn off dictation after sending
    if (isChatSpeechOn) toggleChatSpeech(false);
}

function clearChatMessages() {
    document.getElementById("chatMessages").innerHTML = "";
}

function appendChatMessage(msg, sender) {
    const box = document.getElementById("chatMessages");
    const div = document.createElement("div");
    div.className = sender === "You" ? "chat-msg chat-msg-self" : "chat-msg";
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

// ==== CHAT DICTATION (VOICE TO TEXT) ====
function initChatSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error("Speech Recognition not supported");
        return;
    }

    chatRecognition = new SpeechRecognition();
    chatRecognition.continuous = false; // Stop when the user stops talking
    chatRecognition.interimResults = true;
    chatRecognition.lang = 'en-US';

    chatRecognition.onstart = () => {
        isChatSpeechOn = true;
        updateChatMicUI(true);
    };

    chatRecognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const input = document.getElementById("chatInput");
        if (finalTranscript) {
            const currentVal = input.value.trim();
            input.value = currentVal ? `${currentVal} ${finalTranscript}` : finalTranscript;
            input.placeholder = "Send a message...";
        } else {
            input.placeholder = "Hearing: " + interimTranscript + "...";
        }
    };

    chatRecognition.onerror = (event) => updateChatMicUI(false);
    chatRecognition.onend = () => updateChatMicUI(false);
}

function updateChatMicUI(isActive) {
    isChatSpeechOn = isActive;
    const btn = document.getElementById("chatMicBtn");
    const iconColor = isActive ? "#ef4444" : "#a1a1aa";

    btn.innerHTML = `<i data-lucide="mic" style="width: 16px; color: ${iconColor};"></i>`;
    lucide.createIcons();

    if (!isActive && document.getElementById("chatInput").placeholder.startsWith("Hearing")) {
        document.getElementById("chatInput").placeholder = "Send a message...";
    }
}

function toggleChatSpeech(forceState) {
    if (!chatRecognition) initChatSpeech();
    if (!chatRecognition) return showToast("⚠️ Speech recognition not supported in this browser.");

    const targetState = forceState !== undefined ? forceState : !isChatSpeechOn;

    if (targetState) {
        try {
            chatRecognition.start();
        } catch (e) {
            console.error("Dictation already started", e);
        }
    } else {
        chatRecognition.stop();
        updateChatMicUI(false);
    }
}

// ===============================
// TEXT TO SPEECH (TTS) PANEL
// ===============================

function handleTTSKey(e) {
    if (e.key === 'Enter') speakTTSInput();
}

function speakTTSInput() {
    const input = document.getElementById("ttsInput");
    const text = input.value.trim();
    if (!text) return;

    // Speak audio
    speakText(text);

    // Add to History
    appendTTSHistory(text);

    // Optionally broadcast to chat if connected
    if (socket && currentRoom) {
        socket.emit('signal', { type: "chat", message: text, room: currentRoom });
    }
    appendChatMessage(text, "You");

    // Clear input
    input.value = "";
}

function clearTTSInput() {
    document.getElementById("ttsInput").value = "";
    document.getElementById("ttsInput").focus();
}

function appendTTSHistory(text) {
    const historyBox = document.getElementById("ttsHistory");
    if (!historyBox) return;

    const div = document.createElement("div");
    div.className = "tts-history-item";
    div.innerText = text;
    div.onclick = () => {
        speakText(text);
        if (socket && currentRoom) {
            socket.emit('signal', { type: "chat", message: text, room: currentRoom });
        }
        appendChatMessage(text, "You");
    };

    historyBox.prepend(div);
}

// ===============================
// ACCESSIBILITY FEATURES
// ===============================

// --- SOS EMERGENCY ALERT ---
function triggerSOS() {
    const sosMessage = "🚨 EMERGENCY — I NEED HELP IMMEDIATELY";
    const sosBtn = document.querySelector('.sos-btn');

    // Visual flash
    sosBtn.classList.add('sos-active');
    setTimeout(() => sosBtn.classList.remove('sos-active'), 1500);

    // Set in sentence box
    sentence = sosMessage + " ";
    document.getElementById("sentenceBox").innerText = sosMessage;

    // Auto-speak the alert
    speakText("EMERGENCY. I NEED HELP IMMEDIATELY. Please help me.");

    // Broadcast to chat if connected
    if (socket && currentRoom) {
        socket.emit('signal', { type: "chat", message: sosMessage, room: currentRoom });
    }
    appendChatMessage(sosMessage, "You");

    showToast("🚨 SOS Alert Sent!");
}

// --- QUICK PHRASES ---
function toggleQuickPhrases() {
    const grid = document.getElementById('quickPhrasesGrid');
    const toggle = document.getElementById('qpToggle');
    const isVisible = grid.style.display !== 'none';

    grid.style.display = isVisible ? 'none' : 'grid';
    toggle.classList.toggle('active', !isVisible);
    lucide.createIcons();
}

function usePhrase(phrase) {
    // Add to sentence
    sentence += phrase + " ";
    document.getElementById("sentenceBox").innerText = sentence;

    // Auto-speak
    speakText(phrase);

    // Broadcast to chat if connected
    if (socket && currentRoom) {
        socket.emit('signal', { type: "chat", message: phrase, room: currentRoom });
    }
    appendChatMessage(phrase, "You");

    // Visual feedback
    showToast(`💬 "${phrase}"`);
}

// --- EMOTION QUICK-REACT ---
function sendEmotion(emotionText) {
    // Add to sentence
    sentence += emotionText + " ";
    document.getElementById("sentenceBox").innerText = sentence;

    // Speak the text part (skip emoji)
    const textOnly = emotionText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}❤️]/gu, '').trim();
    speakText(textOnly);

    // Broadcast to chat if connected
    if (socket && currentRoom) {
        socket.emit('signal', { type: "chat", message: emotionText, room: currentRoom });
    }
    appendChatMessage(emotionText, "You");
}

// --- SPEAK HELPER (for quick phrases and SOS) ---
async function speakText(text) {
    if (!text) return;

    // Stop any currently playing speech
    window.speechSynthesis.cancel();

    // Try ElevenLabs
    try {
        const response = await fetch("/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.playbackRate = 0.85;
            audio.preservesPitch = true;
            audio.play();
            return;
        }
    } catch (e) {
        console.error("ElevenLabs error:", e);
    }

    // Fallback: Local TTS
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getBestVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.82;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}

// ===============================
// AUTH0 UI UPDATES
// ===============================

async function updateAuthUI() {
    try {
        const response = await fetch('/user');
        const user = await response.json();
        const authSection = document.getElementById('authSection');

        if (user) {
            authSection.innerHTML = `
                <div class="user-pill" title="${user.email}">
                    <img src="${user.picture}" alt="${user.name}" class="user-avatar">
                    <span class="user-name">${user.nickname || user.name}</span>
                    <a href="/logout" class="btn-logout" title="Sign Out">
                        <i data-lucide="log-out" style="width: 14px;"></i>
                    </a>
                </div>
            `;
        } else {
            authSection.innerHTML = `
                <a href="/login" class="btn btn-primary" style="padding: 6px 14px; font-size: 13px;">
                    <i data-lucide="log-in" style="width: 14px;"></i> Login
                </a>
            `;
        }
        lucide.createIcons();
    } catch (err) {
        console.error("Auth UI Error:", err);
    }
}
