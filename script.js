
// ================================
// ELEMENTS
// ================================
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const statusEl = document.getElementById("status");
const sign = document.getElementById("sign");
const sentence = document.getElementById("sentence");
const wordHistory = document.getElementById("wordHistory");
const speakButton = document.getElementById("speakButton");
const clearButton = document.getElementById("clearButton");
 
// ================================
// VARIABLES
// ================================
let stream = null;
let isRunning = false;
let isSending = false;
let handsReady = false;
 
let words = [];
let candidate = null;
let candidateCount = 0;
let lastAdded = null;
let cooldownUntil = 0;
 
const STABLE_FRAMES = 12;   // ต้องเห็นท่าเดิมกี่เฟรมถึงนับเป็นคำ
const COOLDOWN_MS = 1500;   // เว้นช่วงหลังเพิ่มคำ
 
// ================================
// MEDIAPIPE HANDS
// ================================
const hands = new Hands({
    locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
 
hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
});
 
// ================================
// CONNECTIONS
// ================================
const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
];
 
// ================================
// SIGN CLASSIFIER (แบบกฎ)
// แก้รายการท่าได้ที่ SIGNS ด้านล่าง
// ================================
function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
 
// คืนค่า [thumb, index, middle, ring, pinky] เป็น true = เหยียด
function getFingers(lm) {
    const wrist = lm[0];
 
    // นิ้วชี้-ก้อย: ปลายนิ้วต้องไกลข้อมือมากกว่าข้อกลาง
    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    const others = tips.map((t, i) =>
        dist(lm[t], wrist) > dist(lm[pips[i]], wrist) * 1.1
    );
 
    // นิ้วโป้ง: ปลายโป้งต้องไกลโคนก้อยมากกว่าข้อ IP
    const thumb = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.05;
 
    return [thumb, ...others];
}
 
// pattern: [โป้ง, ชี้, กลาง, นาง, ก้อย]
const SIGNS = [
    { name: "สวัสดี", pattern: [1, 1, 1, 1, 1] },
    { name: "ไม่",    pattern: [0, 0, 0, 0, 0] },
    { name: "ดี",     pattern: [1, 0, 0, 0, 0] },
    { name: "หนึ่ง",   pattern: [0, 1, 0, 0, 0] },
    { name: "สอง",    pattern: [0, 1, 1, 0, 0] }
];
 
function classify(lm) {
    const fingers = getFingers(lm).map(Number);
    for (const s of SIGNS) {
        if (s.pattern.every((v, i) => v === fingers[i])) {
            return s.name;
        }
    }
    return null;
}
 
// ================================
// WORD BUILDING (กันสั่น)
// ================================
function handleSign(name) {
    if (!name) {
        candidate = null;
        candidateCount = 0;
        return;
    }
 
    if (name === candidate) {
        candidateCount++;
    } else {
        candidate = name;
        candidateCount = 1;
    }
 
    const now = Date.now();
    if (
        candidateCount >= STABLE_FRAMES &&
        now > cooldownUntil &&
        name !== lastAdded
    ) {
        words.push(name);
        lastAdded = name;
        cooldownUntil = now + COOLDOWN_MS;
        renderWords();
    }
}
 
function renderWords() {
    sentence.textContent = words.length ? words.join(" ") : "-";
    wordHistory.textContent = words.length
        ? words.map((w, i) => `${i + 1}. ${w}`).join("  |  ")
        : "ยังไม่มีคำ";
}
 
// ================================
// DRAW HAND (พลิกซ้าย-ขวาในโค้ด ไม่ใช้ CSS)
// ================================
function drawHand(landmarks, handColor, labelText) {
    const w = canvas.width;
    const h = canvas.height;
    const px = (p) => (1 - p.x) * w;   // มิเรอร์
    const py = (p) => p.y * h;
 
    // กรอบมือ
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    landmarks.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });
    const pad = 30;
    const boxX = (1 - maxX) * w - pad;
    const boxY = minY * h - pad;
    const boxW = (maxX - minX) * w + pad * 2;
    const boxH = (maxY - minY) * h + pad * 2;
 
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = handColor;
    ctx.lineWidth = 4;
    ctx.stroke();
 
    // เส้น
    connections.forEach(([s, e]) => {
        ctx.beginPath();
        ctx.moveTo(px(landmarks[s]), py(landmarks[s]));
        ctx.lineTo(px(landmarks[e]), py(landmarks[e]));
        ctx.strokeStyle = handColor;
        ctx.lineWidth = 4;
        ctx.stroke();
    });
 
    // จุด
    landmarks.forEach((p, i) => {
        const x = px(p);
        const y = py(p);
 
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
 
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = handColor;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
 
        ctx.fillStyle = handColor;
        ctx.font = "bold 14px Arial";
        ctx.fillText(String(i), x + 10, y - 8);
    });
 
    // ป้ายชื่อมือ
    ctx.font = "bold 20px Arial";
    const tw = ctx.measureText(labelText).width;
    const lx = Math.max(0, boxX);
    const ly = Math.max(35, boxY);
    ctx.fillStyle = handColor;
    ctx.fillRect(lx, ly - 35, tw + 25, 35);
    ctx.fillStyle = "#000";
    ctx.fillText(labelText, lx + 10, ly - 10);
}
 
// ================================
// RESULTS
// ================================
// ตัวติดตามมือ: จำว่ามือแต่ละข้างอยู่ตรงไหน เพื่อให้ป้ายซ้าย/ขวาไม่สลับ
const MAX_JUMP = 0.3;   // ระยะสูงสุด (สัดส่วนของภาพ) ที่ยังถือว่าเป็นมือเดิม
const MAX_MISS = 20;    // จำนวนเฟรมที่มือหายไปแล้วยังจำตำแหน่งไว้
const tracks = { Left: null, Right: null };
 
function resetTracks() {
    tracks.Left = null;
    tracks.Right = null;
}
 
function assignSides(all) {
    const centers = all.map(lm => ({ x: lm[9].x, y: lm[9].y }));
    const sides = new Array(all.length).fill(null);
    const used = { Left: false, Right: false };
 
    // 1) จับคู่มือกับข้างที่เคยติดตามไว้ (ใกล้สุดก่อน)
    const pairs = [];
    centers.forEach((c, i) => {
        ["Left", "Right"].forEach(s => {
            const t = tracks[s];
            if (t) {
                pairs.push({ i, s, d: Math.hypot(c.x - t.x, c.y - t.y) });
            }
        });
    });
    pairs.sort((a, b) => a.d - b.d);
    for (const p of pairs) {
        if (sides[p.i] || used[p.s] || p.d > MAX_JUMP) continue;
        sides[p.i] = p.s;
        used[p.s] = true;
    }
 
    // 2) มือที่ยังไม่มีข้าง: กำหนดจากตำแหน่งบนจอ (เฉพาะตอนเพิ่งเจอมือ)
    //    x ในภาพดิบมาก = อยู่ซ้ายของจอมิเรอร์ = มือซ้าย
    const unmatched = sides
        .map((s, i) => (s ? -1 : i))
        .filter(i => i >= 0);
    const freeSides = ["Left", "Right"].filter(s => !used[s]);
 
    if (unmatched.length === 2 && freeSides.length === 2) {
        const [a, b] = unmatched;
        if (centers[a].x > centers[b].x) {
            sides[a] = "Left";
            sides[b] = "Right";
        } else {
            sides[a] = "Right";
            sides[b] = "Left";
        }
    } else {
        unmatched.forEach(i => {
            if (freeSides.length === 0) return;
            if (freeSides.length === 1) {
                sides[i] = freeSides.pop();
            } else {
                sides[i] = centers[i].x > 0.5 ? "Left" : "Right";
                freeSides.splice(freeSides.indexOf(sides[i]), 1);
            }
        });
    }
 
    // 3) อัปเดตตัวติดตาม
    const seen = { Left: false, Right: false };
    sides.forEach((s, i) => {
        if (!s) return;
        tracks[s] = { x: centers[i].x, y: centers[i].y, miss: 0 };
        seen[s] = true;
    });
    ["Left", "Right"].forEach(s => {
        if (!seen[s] && tracks[s]) {
            tracks[s].miss++;
            if (tracks[s].miss > MAX_MISS) tracks[s] = null;
        }
    });
 
    return sides;
}
 
// แสดงเฉพาะมือที่เจอ (ไม่แสดงข้อความ "ไม่พบมือ")
function showSigns(info) {
    const rows = [];
    if (info.Left !== undefined) {
        rows.push(`<div style="color:#00a152">🖐 มือซ้าย: ${info.Left}</div>`);
    }
    if (info.Right !== undefined) {
        rows.push(`<div style="color:#1565c0">🖐 มือขวา: ${info.Right}</div>`);
    }
 
    sign.style.flexDirection = "column";
    sign.innerHTML = rows.length ? rows.join("") : "-";
}
 
hands.onResults((results) => {
    if (!isRunning) return;
    if (!video.videoWidth) return;
 
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
 
    const all = results.multiHandLandmarks;
 
    if (!all || all.length === 0) {
        assignSides([]);   // นับเฟรมที่มือหาย
        showSigns({});
        handleSign(null);
        return;
    }
 
    const sides = assignSides(all);
    const info = {};
 
    all.forEach((landmarks, i) => {
        const side = sides[i];
        if (!side) return;
 
        const isRight = side === "Right";
        const color = isRight ? "#2196f3" : "#00e676";
        const label = isRight ? "มือขวา" : "มือซ้าย";
        drawHand(landmarks, color, label);
 
        info[side] = classify(landmarks) || "ไม่รู้จักท่านี้";
    });
 
    showSigns(info);
 
    // สร้างประโยคจากมือขวาก่อน ถ้าไม่มีใช้มือซ้าย
    const known = (v) => v && v !== "ไม่รู้จักท่านี้" ? v : null;
    handleSign(known(info.Right) || known(info.Left));
});
 
// ================================
// LOOP (ไม่ใช้ camera_utils)
// ================================
async function loop() {
    if (!isRunning) return;
 
    if (!isSending && video.readyState >= 2) {
        isSending = true;
        try {
            await hands.send({ image: video });
        } catch (err) {
            console.error("hands.send error", err);
        }
        isSending = false;
    }
    requestAnimationFrame(loop);
}
 
// ================================
// START
// ================================
startButton.addEventListener("click", async () => {
    if (isRunning) return;
 
    try {
        startButton.disabled = true;
        startButton.textContent = "⏳ กำลังโหลดโมเดล...";
        sign.textContent = "กำลังโหลดโมเดล (ครั้งแรกอาจใช้เวลา 5-10 วินาที)";
 
        if (!handsReady) {
            await hands.initialize();
            handsReady = true;
        }
 
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
 
        isRunning = true;
        statusEl.textContent = "● ON";
        statusEl.className = "status on";
        startButton.textContent = "✅ กำลังทำงาน";
        stopButton.disabled = false;
        sign.textContent = "ยกมือขึ้นหน้ากล้อง";
 
        loop();
    } catch (err) {
        console.error(err);
        alert(
            "เริ่มระบบไม่สำเร็จ\n\n" +
            "ตรวจสอบว่าเปิดผ่าน http://localhost หรือ https\n" +
            "และอนุญาตการใช้กล้อง\n\n" +
            String(err)
        );
        startButton.disabled = false;
        startButton.textContent = "📷 เปิดกล้อง";
        sign.textContent = "-";
    }
});
 
// ================================
// STOP
// ================================
stopButton.addEventListener("click", () => {
    isRunning = false;
 
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
 
    statusEl.textContent = "● OFF";
    statusEl.className = "status off";
    sign.textContent = "-";
    startButton.textContent = "📷 เปิดกล้อง";
    startButton.disabled = false;
    stopButton.disabled = true;
 
    candidate = null;
    candidateCount = 0;
    resetTracks();
});
 
// ================================
// SPEAK
// ================================
speakButton.addEventListener("click", () => {
    const text = sentence.textContent;
    if (!text || text === "-") return;
 
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "th-TH";
    u.rate = 0.9;
    speechSynthesis.speak(u);
});
 
// ================================
// CLEAR
// ================================
clearButton.addEventListener("click", () => {
    words = [];
    lastAdded = null;
    renderWords();
});
 
// ================================
// INIT
// ================================
stopButton.disabled = true;
renderWords();
 
