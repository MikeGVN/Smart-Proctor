

// ==========================================
// 1. CHEAT MONITOR (QUẢN LÝ VI PHẠM)
// ==========================================
const CheatMonitor = (() => {
    const overlay = document.getElementById('cheat-overlay');
    const timerEl = document.getElementById('cheat-countdown');
    const reasonEl = document.getElementById('violation-reason');
    let timerInterval = null;
    let seconds = 60; // Mặc định là 60s theo yêu cầu
    
    // Biến quản lý trạng thái
    let isViolating = false;
    let isArmed = false;
    let violationLockTime = 0; 

    function init() {
        const btn = overlay.querySelector('button');
        if(btn) btn.style.display = 'none';

        console.log("🛡️ Cheat Monitor: Chờ 5s an toàn...");
        setTimeout(() => {
            isArmed = true;
            console.log("🛡️ Cheat Monitor: ĐÃ KÍCH HOẠT!");
            
            // 1. Rời Tab (Ẩn)
            document.addEventListener("visibilitychange", () => {
                if (document.hidden && isArmed) {
                    trigger("Rời khỏi màn hình thi (Ẩn Tab)!", 5000); 
                }
            });

            // 2. Mất Focus (Click ứng dụng khác)
            window.addEventListener("blur", () => {
                if (isArmed) {
                    trigger("Mất tập trung (Mở ứng dụng khác)!", 5000); 
                }
            });

            // 3. Có Focus trở lại -> Đợi 0.5s rồi tắt
            window.addEventListener("focus", () => {
                if (isViolating) {
                    console.log("⚡ User đã quay lại -> Đợi 0.5s...");
                    violationLockTime = Date.now() + 500; 
                    setTimeout(resolve, 500); 
                }
            });

        }, 5000); 
    }

    function trigger(reason, lockDuration = 0) {
        if (!isArmed) return;
        
        // [CẬP NHẬT] KHÓA CẢNH BÁO: Nếu đang phạt thì không nhận lỗi mới
        if (isViolating) return;

        const unlockTime = Date.now() + lockDuration;
        if (unlockTime > violationLockTime) {
            violationLockTime = unlockTime;
        }

        if (!overlay.classList.contains('active')) {
            isViolating = true;
            overlay.classList.add('active');
            
            seconds = 60; // Reset về 60s mỗi khi vi phạm mới
            timerEl.innerText = seconds;

            if(ExamController.getSocket()) {
                ExamController.getSocket().emit('cheat-warning', { code: ExamController.getExamCode(), msg: reason });
            }

            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                seconds--;
                timerEl.innerText = seconds;
                if (seconds <= 0) {
                    clearInterval(timerInterval);
                    ExamController.submit(true);
                }
            }, 1000);
        }
        reasonEl.innerText = reason;
    }

    function resolve() {
        if (Date.now() < violationLockTime) return;
        if (!document.hasFocus()) return;

        if (overlay.classList.contains('active')) {
            isViolating = false;
            overlay.classList.remove('active');
            if (timerInterval) clearInterval(timerInterval);
        }
    }

    // [CẬP NHẬT] Thêm hàm isActive để AIProctor biết
    return { init, trigger, resolve, isActive: () => isViolating };
})();

// ==========================================
// 2. EXAM CONTROLLER (FIXED: DISABLE CLICK KHI CÓ POPUP)
// ==========================================
const ExamController = (() => {
    let examData = null;
    let currentQ = 0;
    let userAnswers = [];
    const socket = io(); 
    let studentName = "";
    let isSubmitting = false;
    let timerInterval = null;

    window.addEventListener('beforeunload', (e) => {
        if (!isSubmitting) { e.preventDefault(); e.returnValue = ''; }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.key === 'F5') || (e.ctrlKey && e.key === 'r')) { e.preventDefault(); }
    });

    function init() {
        studentName = sessionStorage.getItem('studentName');
        const storedData = sessionStorage.getItem('examData');

        if (!studentName || !storedData) {
            isSubmitting = true; window.location.href = '/'; return;
        }

        examData = JSON.parse(storedData);
        userAnswers = examData.questions.map(q => q.type === 'multi' ? [] : null);
        document.getElementById('student-name').innerText = studentName;
        socket.emit('student-join', { code: examData.code, name: studentName });
        renderQuestion(0);
        handleTimerSync(); 
    }

    function handleTimerSync() {
        socket.emit('request-time', { code: examData.code, studentName: studentName });
    }

    socket.on('server-time-sync', (data) => {
        const { endTime } = data;
        const remainingSeconds = Math.floor((endTime - Date.now()) / 1000);
        if (remainingSeconds <= 0) submit(true); 
        else startTimer(remainingSeconds);
    });

    function renderQuestion(index) {
        currentQ = index;
        const q = examData.questions[index];
        const qType = q.type || 'single'; 

        document.getElementById('q-idx').innerText = index + 1;
        const qContentEl = document.getElementById('q-content');
        const headerInfoEl = document.querySelector('.question-card .text-muted.small');

        if (qType === 'multi') {
            let requiredCount = 0;
            if (typeof q.correctCount !== 'undefined') requiredCount = q.correctCount;
            else if (q.correct && Array.isArray(q.correct)) requiredCount = q.correct.length;

            const currentCount = userAnswers[index] ? userAnswers[index].length : 0;
            if(headerInfoEl) headerInfoEl.style.display = 'none';

            const infoBox = `
                <div class="d-flex align-items-center p-2 mb-3 rounded-3 shadow-sm" style="background-color: #f0f7ff; border: 1px solid #cce5ff; border-left: 4px solid #0d6efd;">
                    <div class="me-3 ps-2">
                        <i class="fas fa-list-check fa-lg text-primary"></i>
                    </div>
                    <div>
                        <div class="fw-bold text-dark fs-6">
                            Chọn ${requiredCount} câu
                        </div>
                        <div class="small text-muted" style="font-size: 0.8rem;">
                            Đã chọn: <span class="text-primary fw-bold">${currentCount}/${requiredCount}</span>
                        </div>
                    </div>
                </div>
            `;
            qContentEl.innerHTML = `${infoBox}<div class="fs-5 text-dark" style="line-height: 1.5;">${q.question}</div>`;

        } else {
            if(headerInfoEl) {
                headerInfoEl.style.display = 'block';
                headerInfoEl.innerHTML = '<i class="fas fa-info-circle"></i> Chọn 1 đáp án đúng';
            }
            qContentEl.innerHTML = `<div class="fs-5 text-dark" style="line-height: 1.5;">${q.question}</div>`;
        }
        
        const container = document.getElementById('options-container');
        container.innerHTML = '';
        const optionKeys = q.options ? Object.keys(q.options).sort() : ['A','B','C','D'];

        optionKeys.forEach((char, i) => {
            let isSelected = false;
            if (qType === 'multi') isSelected = Array.isArray(userAnswers[index]) && userAnswers[index].includes(char);
            else isSelected = userAnswers[index] === char;

            const div = document.createElement('div');
            div.className = `option-box ${isSelected ? 'selected' : ''}`;
            div.id = `opt-${i}`; 
            div.dataset.char = char; 
            
            const iconClass = qType === 'multi' 
                ? (isSelected ? 'fas fa-check-square text-primary' : 'far fa-square text-secondary')
                : (isSelected ? 'fas fa-dot-circle text-primary' : 'far fa-circle text-secondary');

            const content = q.options[char] || "";
            if(content) {
                div.innerHTML = `
                    <span class="me-3" style="width: 24px;"><i class="${iconClass} fa-lg"></i></span>
                    <span class="fw-bold border px-2 py-1 rounded me-3 bg-white shadow-sm" style="min-width: 30px; text-align: center; font-size: 0.9rem;">${char}</span> 
                    <span class="flex-grow-1" style="font-size: 1.1rem;">${content}</span>
                    <div class="loading-bar"></div>
                `;
                div.onclick = () => { select(i); checkAutoNext(); }; 
                container.appendChild(div);
            }
        });
        updateNavButtons();
    }

    function select(optIdx) {
        // [QUAN TRỌNG] CHỐT CHẶN: Nếu đang phạt (Active) HOẶC đang hiện popup SweetAlert (swal2-shown) -> Dừng luôn
        if (CheatMonitor.isActive() || document.body.classList.contains('swal2-shown')) {
            console.log("🚫 Interaction blocked due to active overlay.");
            return;
        }

        const q = examData.questions[currentQ];
        const optionKeys = q.options ? Object.keys(q.options).sort() : ['A','B','C','D'];
        const char = optionKeys[optIdx]; 
        if (!char) return;
        const qType = q.type || 'single';

        if (qType === 'multi') {
            if (!Array.isArray(userAnswers[currentQ])) userAnswers[currentQ] = [];
            const index = userAnswers[currentQ].indexOf(char);
            if (index > -1) userAnswers[currentQ].splice(index, 1); 
            else userAnswers[currentQ].push(char); 
            userAnswers[currentQ].sort(); 
        } else {
            userAnswers[currentQ] = char;
        }
        renderQuestion(currentQ);
        const ansText = Array.isArray(userAnswers[currentQ]) ? userAnswers[currentQ].join(', ') : (userAnswers[currentQ] || '');
        socket.emit('submit-answer', { code: examData.code, answer: `Câu ${currentQ + 1}: ${ansText}` });
    }

    function checkAutoNext() {
        const q = examData.questions[currentQ];
        const qType = q.type || 'single';
        if (qType === 'single') {
            setTimeout(() => { if(currentQ < examData.questions.length - 1) renderQuestion(currentQ + 1); }, 300);
        } else {
            let requiredCount = 0;
            if (typeof q.correctCount !== 'undefined') requiredCount = q.correctCount;
            else if (q.correct && Array.isArray(q.correct)) requiredCount = q.correct.length;
            const currentSelected = userAnswers[currentQ] ? userAnswers[currentQ].length : 0;
            if (requiredCount > 0 && currentSelected >= requiredCount) {
                setTimeout(() => { if(currentQ < examData.questions.length - 1) renderQuestion(currentQ + 1); }, 400); 
            }
        }
    }

    function updateNavButtons() {
        const nav = document.getElementById('nav-numbers');
        nav.innerHTML = '';
        examData.questions.forEach((_, i) => {
            const btn = document.createElement('div');
            let cls = 'nav-btn-number';
            if (i === currentQ) cls += ' active';
            const hasAns = Array.isArray(userAnswers[i]) ? userAnswers[i].length > 0 : userAnswers[i] !== null;
            if (hasAns) cls += ' answered';
            btn.className = cls;
            btn.innerText = i + 1;
            btn.onclick = () => renderQuestion(i);
            nav.appendChild(btn);
        });
        const btnPrev = document.getElementById('btn-prev');
        btnPrev.disabled = (currentQ === 0);
        const btnNext = document.getElementById('btn-next');
        if(currentQ === examData.questions.length - 1) {
             btnNext.innerHTML = 'Nộp Bài <i class="fas fa-check"></i>';
             btnNext.onclick = () => submit(false);
        } else {
             btnNext.innerHTML = 'Tiếp <i class="fas fa-chevron-right"></i>';
             btnNext.onclick = () => { 
                // Thêm check cả ở nút Next cho chắc ăn
                if (!CheatMonitor.isActive() && !document.body.classList.contains('swal2-shown') && currentQ < examData.questions.length - 1) {
                    renderQuestion(currentQ + 1);
                }
             };
        }
    }

    function startTimer(duration) {
        let timer = duration;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const m = Math.floor(timer / 60).toString().padStart(2,'0');
            const s = (timer % 60).toString().padStart(2,'0');
            const el = document.getElementById('exam-timer');
            if(el) el.innerText = `${m}:${s}`;
            if (--timer < 0) { clearInterval(timerInterval); submit(true); }
        }, 1000);
    }

    function submit(force = false) {
        const storageKey = `endTime_${examData.code}_${studentName}`;
        if (force) {
            isSubmitting = true; sessionStorage.removeItem(storageKey);
            alert("Hết thời gian hoặc vi phạm quy chế!"); window.location.href = '/'; 
        } else {
            const unanswered = userAnswers.map((ans, index) => {
                if (Array.isArray(ans)) return ans.length === 0 ? index + 1 : null;
                return ans === null ? index + 1 : null;
            }).filter(item => item !== null);
            let htmlContent = unanswered.length > 0
                ? `<p class="text-danger">Còn ${unanswered.length} câu chưa làm: <b>${unanswered.join(', ')}</b></p>`
                : `<p class="text-success fw-bold">Đã hoàn thành 100%!</p>`;
            Swal.fire({
                title: 'Nộp bài thi?', html: htmlContent, icon: unanswered.length > 0 ? 'warning' : 'success',
                showCancelButton: true, confirmButtonColor: '#dc3545', confirmButtonText: 'NỘP NGAY'
            }).then((res) => { 
                if (res.isConfirmed) {
                    isSubmitting = true; sessionStorage.removeItem(storageKey);
                    socket.emit('finish-exam', { code: examData.code, answers: userAnswers });
                    window.location.href = '/'; 
                }
            });
        }
    }

    return { 
        init, next: () => currentQ < examData.questions.length - 1 && renderQuestion(currentQ+1), 
        prev: () => currentQ > 0 && renderQuestion(currentQ-1), 
        select, submit, getSocket: () => socket, getExamCode: () => examData?.code,
        checkAutoNext
    };
})();
// ==========================================
// 3. AI PROCTOR (FIXED: AI NGỪNG HOẠT ĐỘNG KHI CÓ POPUP)
// ==========================================
const AIProctor = (() => {
    const video = document.querySelector('.input_video');
    const canvas = document.querySelector('.output_canvas');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('gesture-status');
    const loadingEl = document.getElementById('ai-loading');
    
    let handsModel, faceModel, phoneModel;
    let isLoaded = false;
    let lastFaceCheck = 0;
    let lastPhoneCheck = 0;
    let gestureTimer = null;
    let lastGesture = -1;

    let badFrameCount = 0;
    let safeFrameCount = 0;
    let lastLoopTime = Date.now();
    let currentStatusText = "";
    let verifiedSignature = null;

    function calculateFaceSignature(landmarks) {
        const getDist = (i1, i2) => {
            const p1 = landmarks[i1]; const p2 = landmarks[i2];
            return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        };
        const eyeDist = getDist(33, 263); 
        if (eyeDist === 0) return null; 
        return [
            getDist(1, 152) / eyeDist, 
            getDist(10, 152) / eyeDist, 
            getDist(61, 291) / eyeDist, 
            getDist(1, 454) / eyeDist,  
            getDist(1, 234) / eyeDist   
        ];
    }

    function updateStatus(text, type) {
        if (currentStatusText !== text) {
            statusEl.innerText = text;
            statusEl.className = `fw-bold fs-5 text-${type} status-badge`;
            currentStatusText = text;
        }
    }

    async function init() {
        try {
            updateStatus("Camera: Đang khởi động...", "warning");
            const storedSig = sessionStorage.getItem('faceSignature');
            if (storedSig) verifiedSignature = JSON.parse(storedSig);

            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            video.srcObject = stream;
            await new Promise(r => video.onloadedmetadata = r);
            video.play();

            handsModel = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
            handsModel.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5 });
            handsModel.onResults(onHandResults);

            faceModel = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceModel.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5 });
            faceModel.onResults(onFaceResults);

            cocoSsd.load({ base: 'lite_mobilenet_v2' }).then(model => { phoneModel = model; }).catch(err => console.log(err));
            
            if(loadingEl) loadingEl.style.display = 'none';
            isLoaded = true;
            requestAnimationFrame(loop);
            setInterval(checkCameraHealth, 500);
        } catch (e) {
            if(loadingEl) loadingEl.style.display = 'none';
            updateStatus("Camera: Lỗi", "danger");
        }
    }

    function checkCameraHealth() {
        if (statusEl.innerText.includes("đáp án")) return;
        updateStatus("Camera: Đang hoạt động", "success");
    }

    async function loop() {
        lastLoopTime = Date.now(); 
        if (video.readyState >= 2) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        const now = Date.now();
        if (isLoaded && video.readyState >= 2) {
            await handsModel.send({image: video}); 
            if (now - lastFaceCheck > 100) { await faceModel.send({image: video}); lastFaceCheck = now; } 
            if (phoneModel && (now - lastPhoneCheck > 500)) { detectPhone(video); lastPhoneCheck = now; }
        }
        requestAnimationFrame(loop);
    }

    function onHandResults(results) {
        // [QUAN TRỌNG] Nếu đang có Popup (SweetAlert) hoặc Cảnh báo Cheat -> KHÔNG XỬ LÝ CỬ CHỈ TAY
        if (CheatMonitor.isActive() || document.body.classList.contains('swal2-shown')) {
            resetGesture();
            return;
        }

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            let count = 0;
            if (lm[8].y < lm[6].y) count++; 
            if (lm[12].y < lm[10].y) count++;
            if (lm[16].y < lm[14].y) count++;
            if (lm[20].y < lm[18].y) count++;
            handleGesture(count);
        } else {
            resetGesture();
        }
    }

    function handleGesture(count) {
        if (count >= 1 && count <= 5) {
            const optIdx = count - 1;
            if (count !== lastGesture) {
                if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null; }
                document.querySelectorAll('.loading-bar').forEach(el => el.style.width = '0%');
                document.querySelectorAll('.option-box').forEach(el => el.classList.remove('loading'));
                
                const targetOpt = document.getElementById(`opt-${optIdx}`);
                if (!targetOpt) return;

                const targetBar = targetOpt.querySelector('.loading-bar');
                if (targetOpt) targetOpt.classList.add('loading');
                if (targetBar) targetBar.style.width = '100%';
                
                const char = targetOpt.dataset.char || "?";
                updateStatus(`Đang giữ đáp án ${char}...`, "warning");
                
                lastGesture = count;
                gestureTimer = setTimeout(() => {
                    ExamController.select(optIdx);
                    updateStatus(`Đã chọn: ${char}`, "success");
                    setTimeout(() => { 
                        ExamController.checkAutoNext(); 
                        resetGesture(); 
                    }, 500);
                }, 500); 
            }
        } else { resetGesture(); }
    }

    function resetGesture() {
        if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null; }
        lastGesture = -1;
        document.querySelectorAll('.loading-bar').forEach(el => el.style.width = '0%');
        document.querySelectorAll('.option-box').forEach(el => el.classList.remove('loading'));
    }

    function onFaceResults(results) {
        let isBad = false;
        let reason = "";

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const face = results.multiFaceLandmarks[0];
            const nose = face[1]; const leftCheek = face[234]; const rightCheek = face[454];
            const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
            const leftRatio = Math.abs(nose.x - leftCheek.x) / faceWidth; 

            const noseY = face[1].y; const topY = face[10].y; const chinY = face[152].y;
            const vRatio = Math.abs(noseY - topY) / Math.abs(chinY - topY); 

            if (leftRatio < 0.20) { isBad = true; reason = "Đang quay mặt sang TRÁI!"; }
            else if (leftRatio > 0.80) { isBad = true; reason = "Đang quay mặt sang PHẢI!"; }

            if (!isBad) { 
                if (vRatio < 0.38) { isBad = true; reason = "Đang nhìn lên!"; }
                else if (vRatio > 0.75) { isBad = true; reason = "Đang cúi đầu quá thấp!"; }
            }

            const isSuperStable = (leftRatio > 0.40 && leftRatio < 0.60) && (vRatio > 0.45 && vRatio < 0.65);
            if (!isBad && verifiedSignature && isSuperStable && !CheatMonitor.isActive()) {
                const currentSig = calculateFaceSignature(face);
                if (currentSig) {
                    let diff = 0;
                    for(let i=0; i<5; i++) diff += Math.abs(currentSig[i] - verifiedSignature[i]);
                    if (diff > 0.6) { isBad = true; reason = "CẢNH BÁO: KHÔNG ĐÚNG NGƯỜI!"; }
                }
            }
        } else { isBad = true; reason = "Không thấy khuôn mặt!"; }

        if (isBad) {
            badFrameCount++; safeFrameCount = 0; 
            if (badFrameCount > 3) CheatMonitor.trigger(reason);
        } else {
            safeFrameCount++; badFrameCount = 0; 
            if (safeFrameCount > 12) CheatMonitor.resolve();
        }
    }

    async function detectPhone(videoInput) {
        if (CheatMonitor.isActive()) return;
        try {
            const predictions = await phoneModel.detect(videoInput, 3, 0.35);
            const hasPhone = predictions.some(p => p.class === 'cell phone' || (p.class === 'remote' && p.score > 0.4));
            if (hasPhone) CheatMonitor.trigger("Phát hiện ĐIỆN THOẠI!", 1500); 
        } catch (e) { console.error(e); }
    }

    return { init };
})();

window.onload = () => {
    ExamController.init();
    AIProctor.init();
    CheatMonitor.init();
    // --- BẢO MẬT: CHẶN COPY & CHUỘT PHẢI TOÀN TRANG ---
    
    // 1. Chặn menu chuột phải trên toàn bộ trang
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // Không hiện thông báo gì cả cho ngầu, hoặc hiện nếu muốn
    });

    // 2. Chặn phím tắt (Ctrl+C, Ctrl+P, F12...)
    document.addEventListener('keydown', (e) => {
        // Chặn F12 (DevTools)
        if(e.key === "F12") {
            e.preventDefault();
            return;
        }

        // Chặn Ctrl + (C, V, X, P, U, I, S)
        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (['c', 'v', 'x', 'p', 'u', 'i', 's'].includes(key)) {
                e.preventDefault();
            }
        }
    });
};
