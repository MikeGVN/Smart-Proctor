
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
// 2. EXAM CONTROLLER (UPDATE: TRUYỀN THÊM CLASS SANG SCORE)
// ==========================================
const ExamController = (() => {
    let examData = null;
    let currentQ = 0;
    let userAnswers = [];
    const socket = io(); 
    let studentName = "";
    let isSubmitting = false;
    let timerInterval = null;
    let isForcedExit = false;
    // --- 1. LẮNG NGHE KẾT QUẢ TỪ SERVER ---
    socket.on('exam-result', (data) => {
        const resultFull = {
            score: data.score,
            studentName: sessionStorage.getItem('studentName'),
            studentId: sessionStorage.getItem('studentId'),
            studentClass: sessionStorage.getItem('studentClass'), 
            examCode: examData.code,
            submittedAt: new Date().toISOString()
        };
        sessionStorage.setItem('examResult', JSON.stringify(resultFull));
        sessionStorage.setItem('isFinished', 'true');
        // [LOGIC MỚI] Nếu là bị ép nộp (Force) thì KHÔNG chuyển trang ngay
        // Để người dùng còn kịp bấm nút Kháng nghị
        if (!isForcedExit) {
            if(Swal.isVisible()) Swal.close();
            window.location.href = '/student/score.html';
        }
    });

    // --- CÁC HÀM CƠ BẢN GIỮ NGUYÊN ---
    window.addEventListener('beforeunload', (e) => {
        if (!isSubmitting) { e.preventDefault(); e.returnValue = ''; }
    });

    document.addEventListener('keydown', (e) => {
        if ((e.key === 'F5') || (e.ctrlKey && e.key === 'r')) { e.preventDefault(); }
    });
    // --- [MỚI] LOGIC CHỐNG THOÁT TAB/RELOAD ---
    
    // 1. Hàm gửi bài khẩn cấp (keepalive)
    async function handleEmergencySubmit() {
        if (isSubmitting) return null; 
        isSubmitting = true;

        const payload = {
            code: examData.code,
            answers: userAnswers,
            studentName: sessionStorage.getItem('studentName'),
            studentId: sessionStorage.getItem('studentId'),
            studentClass: sessionStorage.getItem('studentClass')
        };

        // Đánh dấu đã thi xong
        sessionStorage.setItem('isFinished', 'true');

        try {
            // [FIX] Cần await response và lấy kết quả trả về
            const res = await fetch('/api/emergency-submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true 
            });
            const data = await res.json();
            return data; // [QUAN TRỌNG] Trả về data để dùng cho nút Back
        } catch (e) { 
            console.error(e); 
            return null;
        }
    }

    // 2. Bắt sự kiện tắt tab hoặc reload
    window.addEventListener('beforeunload', (e) => {
        if (!isSubmitting) {
            // Hiện popup hỏi xác nhận (Standard Browser Behavior)
            e.preventDefault();
            e.returnValue = ''; 
        }
    });

    // 3. Khi người dùng thực sự rời đi
    window.addEventListener('unload', () => {
        if (!isSubmitting) handleEmergencySubmit();
    });
    
    // 4. (Tuỳ chọn) Khi ẩn tab trên điện thoại
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === 'hidden') {
            // handleEmergencySubmit(); // Bỏ comment dòng này nếu muốn gắt (ẩn tab là nộp luôn)
        }
    });
    function init() {
        if (sessionStorage.getItem('isFinished') === 'true') {
            window.location.href = '/student/score.html';
            return;
        }

        // CHẶN BACK/FORWARD VÀ NỘP BÀI NGAY
        history.pushState(null, null, location.href);
        window.addEventListener('popstate', () => {
            history.pushState(null, null, location.href); // Khóa lại ngay
            
            Swal.fire({
                title: 'CẢNH BÁO RỜI PHÒNG THI!',
                text: "Hành động này sẽ được tính là NỘP BÀI ngay lập tức!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Rời đi & Nộp bài',
                cancelButtonText: 'Ở lại làm tiếp',
                allowOutsideClick: false
            }).then(async (result) => {
                if (result.isConfirmed) {
                    Swal.fire({ 
                        title: 'Đang nộp bài...', 
                        text: 'Vui lòng không tắt trình duyệt', 
                        allowOutsideClick: false, 
                        didOpen: () => Swal.showLoading() 
                    });
                    
                    // [FIX QUAN TRỌNG] Lấy kết quả trả về từ hàm Emergency Submit
                    const resultData = await handleEmergencySubmit();
                    
                    if (resultData && resultData.success) {
                        // Tạo đối tượng kết quả giả lập để lưu vào SessionStorage ngay lập tức
                        // Giúp trang Score có dữ liệu luôn mà không cần query lại Server
                        const mockResult = {
                            score: resultData.score,
                            studentName: sessionStorage.getItem('studentName'),
                            studentId: sessionStorage.getItem('studentId'),
                            studentClass: sessionStorage.getItem('studentClass'),
                            examCode: examData.code,
                            submittedAt: new Date().toISOString(),
                            violations: [], // Mặc định rỗng hoặc lấy từ biến global nếu cần
                            isEmergency: true
                        };
                        sessionStorage.setItem('examResult', JSON.stringify(mockResult));
                    }
                    
                    window.location.replace('/student/score.html');
                }
            });
        });
        // -----------------------------------------------------------

        studentName = sessionStorage.getItem('studentName');
        const storedData = sessionStorage.getItem('examData');

        if (!studentName || !storedData) {
            isSubmitting = true; 
            window.location.href = '/'; 
            return;
        }

        examData = JSON.parse(storedData);
        userAnswers = examData.questions.map(q => q.type === 'multi' ? [] : null);
        document.getElementById('student-name').innerText = studentName;
        
        socket.emit('student-join', { 
            code: examData.code, 
            name: studentName,
            studentId: sessionStorage.getItem('studentId'),
            studentClass: sessionStorage.getItem('studentClass')
        });
        
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
                    <div class="me-3 ps-2"><i class="fas fa-list-check fa-lg text-primary"></i></div>
                    <div>
                        <div class="fw-bold text-dark fs-6">Chọn ${requiredCount} câu</div>
                        <div class="small text-muted" style="font-size: 0.8rem;">Đã chọn: <span class="text-primary fw-bold">${currentCount}/${requiredCount}</span></div>
                    </div>
                </div>`;
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
        if (CheatMonitor.isActive() || document.body.classList.contains('swal2-shown')) return;

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
            let requiredCount = q.correctCount || (q.correct && Array.isArray(q.correct) ? q.correct.length : 0);
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
        
        const doSubmit = () => {
            isSubmitting = true; 
            sessionStorage.removeItem(storageKey);
            
            // Gửi bài lên server
            socket.emit('finish-exam-full', { 
                code: examData.code, 
                answers: userAnswers,
                studentName: studentName,
                studentId: sessionStorage.getItem('studentId'),
                studentClass: sessionStorage.getItem('studentClass')
            });
        };

        if (force) {
            // [THAY ĐỔI LỚN TẠI ĐÂY]
            // Không dùng alert nữa. Hiện Overlay
            isForcedExit = true; // Bật cờ để chặn redirect
            doSubmit(); // Nộp bài ngầm bên dưới

            const reasonText = "Hết giờ làm bài hoặc Phát hiện vi phạm quy chế nhiều lần!";
            document.getElementById('forced-reason').innerText = reasonText;
            document.getElementById('forced-submit-overlay').classList.remove('d-none');
            
            // Xóa overlay gian lận cũ nếu đang hiện
            document.getElementById('cheat-overlay').classList.remove('active');
            
        } else {
            // Logic nộp thường giữ nguyên
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
            }).then((res) => { if (res.isConfirmed) doSubmit(); });
        }
    }
// 2. SỬA HÀM SUBMIT
    function submit(force = false) {
        const storageKey = `endTime_${examData.code}_${studentName}`;
        
        const doSubmit = () => {
            isSubmitting = true; 
            sessionStorage.removeItem(storageKey);
            
            // Gửi bài lên server
            socket.emit('finish-exam-full', { 
                code: examData.code, 
                answers: userAnswers,
                studentName: studentName,
                studentId: sessionStorage.getItem('studentId'),
                studentClass: sessionStorage.getItem('studentClass')
            });
        };

        if (force) {
            // [THAY ĐỔI LỚN TẠI ĐÂY]
            // Không dùng alert nữa. Hiện Overlay
            isForcedExit = true; // Bật cờ để chặn redirect
            doSubmit(); // Nộp bài ngầm bên dưới

            const reasonText = "Hết giờ làm bài hoặc Phát hiện vi phạm quy chế nhiều lần!";
            document.getElementById('forced-reason').innerText = reasonText;
            document.getElementById('forced-submit-overlay').classList.remove('d-none');
            
            // Xóa overlay gian lận cũ nếu đang hiện
            document.getElementById('cheat-overlay').classList.remove('active');
            
        } else {
            // Logic nộp thường giữ nguyên
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
            }).then((res) => { if (res.isConfirmed) doSubmit(); });
        }
    }

    // 3. THÊM HÀM MỞ FORM KHÁNG NGHỊ
    function openAppealForm() {
        const sName = sessionStorage.getItem('studentName');
        const sClass = sessionStorage.getItem('studentClass') || '---';
        const sId = sessionStorage.getItem('studentId') || '---';

        // Xóa các listener cũ để tránh bị gọi nhiều lần
        socket.off('appeal-success');
        socket.off('appeal-failed');

        // [MỚI] Lắng nghe phản hồi từ server trước khi mở form
        socket.on('appeal-success', () => {
            Swal.fire({
                title: 'Đã gửi thành công!',
                text: 'Đơn kháng nghị của bạn đã được chuyển đến giảng viên.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                // [QUAN TRỌNG] Chuyển về trang chủ
                window.location.href = 'index.html';
            });
        });

        socket.on('appeal-failed', (msg) => {
            Swal.fire('Gửi thất bại', msg, 'error');
        });

        Swal.fire({
            title: 'ĐƠN KHÁNG NGHỊ',
            html: `
                <div class="text-start mb-3" style="font-size: 0.9rem; background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <p class="mb-1"><strong>Họ tên:</strong> ${sName}</p>
                    <p class="mb-1"><strong>Lớp:</strong> ${sClass}</p>
                    <p class="mb-0"><strong>MSSV:</strong> ${sId}</p>
                </div>
                <div class="text-start">
                    <label class="small fw-bold text-secondary mb-1">Lý do / Giải trình:</label>
                    <textarea id="appeal-reason" class="form-control" rows="4" placeholder="Ví dụ: Camera em bị lỗi, mạng bị lag..."></textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#ffc107',
            confirmButtonText: 'Gửi Kháng Nghị',
            cancelButtonText: 'Hủy bỏ',
            preConfirm: () => {
                const reason = document.getElementById('appeal-reason').value;
                if (!reason) return Swal.showValidationMessage('Vui lòng nhập lý do!');
                return reason;
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Gửi socket
                socket.emit('submit-appeal', {
                    code: examData.code,
                    studentName: sName,
                    // Không gửi studentId nữa để server tìm theo Tên cho dễ khớp
                    reason: result.value
                });
                
                // Hiện loading trong lúc chờ server phản hồi
                Swal.showLoading();
            }
        });
    }
    return { 
        init, 
        next: () => currentQ < examData.questions.length - 1 && renderQuestion(currentQ+1), 
        prev: () => currentQ > 0 && renderQuestion(currentQ-1), 
        select, 
        submit, 
        getSocket: () => socket, 
        getExamCode: () => examData?.code,
        checkAutoNext,
        openAppealForm // <--- BẮT BUỘC PHẢI CÓ DÒNG NÀY
    };
})();
// ==========================================
// 3. AI PROCTOR (ĐÃ TỐI ƯU: TĂNG ĐỘ NHẠY GÓC NGHIÊNG & GIẢM DELAY 1.5S)
// ==========================================
const AIProctor = (() => {
    const video = document.querySelector('.input_video');
    const canvas = document.querySelector('.output_canvas');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('gesture-status');
    const loadingEl = document.getElementById('ai-loading');
    
    let handsModel;
    let faceModel;
    let phoneModel;
    let isLoaded = false;
    
    // Biến kiểm soát thời gian (Throttling) để giảm lag
    let lastStreamTime = 0;
    let lastFaceCheck = 0;
    let lastPhoneCheck = 0;
    let lastHandCheck = 0;

    let gestureTimer = null;
    let lastGesture = -1;
    let verifiedSignature = null;
    let currentStatusText = "";

    // [CẬP NHẬT] Biến theo dõi thời gian bắt đầu vi phạm (Debounce 1.5s)
    let faceViolationStartTime = 0;
    let phoneViolationStartTime = 0;

    // Hàm tính vector khuôn mặt
    function calculateFaceSignature(landmarks) {
        const getDist = (i1, i2) => {
            const p1 = landmarks[i1]; 
            const p2 = landmarks[i2];
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
        if(statusEl && currentStatusText !== text) {
            statusEl.innerText = text;
            statusEl.className = `fw-bold fs-5 text-${type} status-badge`;
            currentStatusText = text;
        }
    }

    async function init() {
        try {
            updateStatus("Camera: Đang khởi động...", "warning");
            const storedSig = sessionStorage.getItem('faceSignature');
            if (storedSig) {
                verifiedSignature = JSON.parse(storedSig);
            }

            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } });
            video.srcObject = stream;
            await new Promise(resolve => video.onloadedmetadata = resolve);
            video.play();

            handsModel = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
            handsModel.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5 });
            handsModel.onResults(onHandResults);

            faceModel = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceModel.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5 });
            faceModel.onResults(onFaceResults);

            cocoSsd.load({ base: 'lite_mobilenet_v2' }).then(model => { phoneModel = model; }).catch(err => console.log(err));
            
            if(loadingEl) {
                loadingEl.style.display = 'none';
            }
            isLoaded = true;
            
            updateStatus("Sẵn sàng", "success");
            
            requestAnimationFrame(loop);
            
        } catch (e) {
            console.error(e);
            if(loadingEl) {
                loadingEl.style.display = 'none';
            }
            updateStatus("Lỗi Camera!", "danger");
        }
    }

    async function loop() {
        if (video.readyState >= 2) {
            // 1. Vẽ video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const now = Date.now();

            // 2. Gửi Stream (Giới hạn 1 FPS)
            if (now - lastStreamTime > 1000) { 
                const imageData = canvas.toDataURL('image/jpeg', 0.4); 
                if(ExamController.getSocket()) {
                    ExamController.getSocket().emit('student-stream-upload', { 
                        code: ExamController.getExamCode(),
                        image: imageData 
                    });
                }
                lastStreamTime = now;
            }

            // 3. AI Detect
            if (isLoaded) {
                // Check tay mỗi 200ms
                if (now - lastHandCheck > 200) { 
                    await handsModel.send({image: video}); 
                    lastHandCheck = now; 
                }
                
                // Check mặt mỗi 200ms
                if (now - lastFaceCheck > 200) { 
                    await faceModel.send({image: video}); 
                    lastFaceCheck = now; 
                } 
                
                // Check điện thoại mỗi 500ms
                if (phoneModel && (now - lastPhoneCheck > 500)) { 
                    detectPhone(video); 
                    lastPhoneCheck = now; 
                }
            }
        }
        requestAnimationFrame(loop);
    }

    function onHandResults(results) {
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
                if (gestureTimer) { 
                    clearTimeout(gestureTimer); 
                    gestureTimer = null; 
                }
                document.querySelectorAll('.loading-bar').forEach(el => el.style.width = '0%');
                document.querySelectorAll('.option-box').forEach(el => el.classList.remove('loading'));
                
                const targetOpt = document.getElementById(`opt-${optIdx}`);
                if (targetOpt) {
                    targetOpt.classList.add('loading');
                    const bar = targetOpt.querySelector('.loading-bar');
                    if(bar) bar.style.width = '100%';
                    
                    const char = targetOpt.dataset.char || "?";
                    lastGesture = count;
                    gestureTimer = setTimeout(() => {
                        ExamController.select(optIdx);
                        updateStatus(`Đã chọn: ${char}`, "success");
                        setTimeout(() => { 
                            ExamController.checkAutoNext(); 
                            resetGesture(); 
                            updateStatus("Sẵn sàng", "success"); 
                        }, 800);
                    }, 500); 
                }
            }
        } else { 
            resetGesture(); 
        }
    }

    function resetGesture() {
        if (gestureTimer) { 
            clearTimeout(gestureTimer); 
            gestureTimer = null; 
        }
        lastGesture = -1;
        document.querySelectorAll('.loading-bar').forEach(el => el.style.width = '0%');
        document.querySelectorAll('.option-box').forEach(el => el.classList.remove('loading'));
    }

    function onFaceResults(results) {
        let isBad = false; 
        let reason = "";
        
        // Biến này để check xem frame hiện tại có thực hiện so khớp FaceID không
        let isFaceIdChecked = false; 

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const face = results.multiFaceLandmarks[0];
            const nose = face[1]; 
            const leftCheek = face[234]; 
            const rightCheek = face[454];
            const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
            const leftRatio = Math.abs(nose.x - leftCheek.x) / faceWidth; 
            const noseY = face[1].y; 
            const topY = face[10].y; 
            const chinY = face[152].y;
            const vRatio = Math.abs(noseY - topY) / Math.abs(chinY - topY); 

            // Logic Quay Trái/Phải
            if (leftRatio < 0.20) { 
                isBad = true; 
                reason = "Quay mặt TRÁI"; 
            } else if (leftRatio > 0.80) { 
                isBad = true; 
                reason = "Quay mặt PHẢI"; 
            }
            
            if (!isBad) { 
                // Logic Nhìn Lên/Xuống
                if (vRatio < 0.43) { 
                    isBad = true; 
                    reason = "Nhìn LÊN"; 
                } else if (vRatio > 0.65) { 
                    isBad = true; 
                    reason = "Cúi quá THẤP"; 
                }
            }
            
            // Tính độ ổn định
            const isSuperStable = (leftRatio > 0.40 && leftRatio < 0.60) && (vRatio > 0.45 && vRatio < 0.65);

            // [FIX 1] BỎ ĐIỀU KIỆN !CheatMonitor.isActive()
            // Dù đang bị phạt vẫn phải check để biết khi nào user quay lại đúng người
            if (!isBad && verifiedSignature && isSuperStable) {
                const currentSig = calculateFaceSignature(face);
                if (currentSig) {
                    isFaceIdChecked = true; // Đánh dấu là đã check ID frame này
                    let diff = 0;
                    for(let i=0; i<5; i++) {
                        diff += Math.abs(currentSig[i] - verifiedSignature[i]);
                    }
                    
                    // console.log("Diff:", diff.toFixed(2)); 

                    if (diff > 0.75) { 
                        isBad = true; 
                        reason = "SAI NGƯỜI"; 
                    }
                }
            }
        } else { 
            isBad = true; 
            reason = "Không thấy mặt"; 
        }

        // Xử lý Hậu quả
        if (isBad) {
            const currentTime = Date.now();
            if (faceViolationStartTime === 0) {
                faceViolationStartTime = currentTime;
                updateStatus(`⚠️ Cảnh báo: ${reason}...`, "warning");
            } else if (currentTime - faceViolationStartTime > 1500) {
                CheatMonitor.trigger(reason);
                faceViolationStartTime = 0;
            }
        } else {
            // [FIX 2] LOGIC CHỐNG FLICKER (CHỚP TẮT)
            // Nếu Signature có tồn tại, nhưng Frame này KHÔNG check được ID (do chưa stable)
            // VÀ hiện tại đang bị lỗi "SAI NGƯỜI" -> Thì giữ nguyên, KHÔNG tắt cảnh báo.
            // Chờ đến khi user ngồi im (Stable) và check ra đúng người thì mới tắt.
            if (verifiedSignature && !isFaceIdChecked && currentStatusText.includes("SAI NGƯỜI")) {
                 // Do nothing - Giữ nguyên trạng thái cảnh báo
                 return;
            }

            faceViolationStartTime = 0;
            CheatMonitor.resolve();
            updateStatus("Sẵn sàng", "success");
        }
    }

    async function detectPhone(videoInput) {
        if (CheatMonitor.isActive()) return;
        try {
            const predictions = await phoneModel.detect(videoInput, 3, 0.35);
            const hasPhone = predictions.some(p => p.class === 'cell phone' || (p.class === 'remote' && p.score > 0.4));
            
            // Xử lý độ trễ 1.5 giây cho lỗi điện thoại
            if (hasPhone) {
                const currentTime = Date.now();
                if (phoneViolationStartTime === 0) {
                    phoneViolationStartTime = currentTime;
                    updateStatus("⚠️ Phát hiện thiết bị lạ...", "warning");
                } else if (currentTime - phoneViolationStartTime > 1500) {
                    CheatMonitor.trigger("Phát hiện ĐIỆN THOẠI!", 1500);
                    phoneViolationStartTime = 0;
                }
            } else {
                phoneViolationStartTime = 0;
            }
        } catch (e) { 
            console.error(e); 
        }
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
