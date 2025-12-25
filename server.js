

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('../student/index.html'));

// DATA PATHS
const DATA_DIR = path.join(__dirname, 'data');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const TEACHERS_FILE = path.join(DATA_DIR, 'teachers.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json'); // [NEW] Lưu kết quả thi
// --- [MỚI] HÀM LƯU FILE AN TOÀN (CHỐNG GHI ĐÈ) ---
let isSaving = false;

async function saveResultSafe(newResult) {
    // 1. Nếu đang có người khác ghi, chờ 50ms rồi thử lại
    while(isSaving) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // 2. Khóa lại
    isSaving = true;
    
    try {
        const results = await fs.readJson(RESULTS_FILE);
        results.push(newResult);
        await fs.writeJson(RESULTS_FILE, results);
    } catch (e) {
        console.error("Lỗi ghi file:", e);
    } finally {
        // 3. Mở khóa
        isSaving = false;
    }
}
// INIT DB
(async () => {
    await fs.ensureDir(DATA_DIR);
    if (!await fs.pathExists(EXAMS_FILE)) await fs.writeJson(EXAMS_FILE, []);
    if (!await fs.pathExists(RESULTS_FILE)) await fs.writeJson(RESULTS_FILE, []); // [NEW]
    if (!await fs.pathExists(TEACHERS_FILE)) {
        await fs.writeJson(TEACHERS_FILE, [{ id: 1, name: "Admin Teacher", email: "admin@gmail.com", password: "123" }]);
    }
    console.log('📂 Database Ready.');
})();

// --- API ROUTES ---

// 1. Teacher Login
app.post('/api/teacher/login', async (req, res) => {
    const { email, password } = req.body;
    const teachers = await fs.readJson(TEACHERS_FILE);
    const teacher = teachers.find(t => t.email === email && t.password === password);
    teacher ? res.json({ success: true, teacher: { name: teacher.name, email: teacher.email } }) 
            : res.json({ success: false, msg: 'Sai thông tin!' });
});

// 2. CRUD Exams
app.get('/api/exams', async (req, res) => {
    res.json(await fs.readJson(EXAMS_FILE));
});

app.post('/api/create-exam', async (req, res) => {
    try {
        const { title, code, duration, questions, maxAttempts, startTime, endTime } = req.body; 
        const exams = await fs.readJson(EXAMS_FILE);

        const index = exams.findIndex(e => e.code === code);

        const examData = {
            title, code, 
            duration: parseInt(duration) || 60,
            maxAttempts: parseInt(maxAttempts), // Nếu là -1 thì là không giới hạn
            startTime, 
            endTime,   
            questions, 
            active: true
        };

        if (index !== -1) {
            // [LOGIC MỚI] Nếu mã đề đã tồn tại -> CẬP NHẬT (UPDATE)
            // Giữ lại ID và ngày tạo cũ
            exams[index] = { 
                ...exams[index], 
                ...examData, 
                id: exams[index].id, 
                createdAt: exams[index].createdAt 
            };
            await fs.writeJson(EXAMS_FILE, exams);
            res.json({ success: true, msg: 'Cập nhật đề thi thành công!' });
        } else {
            // [LOGIC CŨ] Nếu chưa có -> TẠO MỚI
            exams.push({
                ...examData,
                id: Date.now(),
                createdAt: new Date().toISOString()
            });
            await fs.writeJson(EXAMS_FILE, exams);
            res.json({ success: true, msg: 'Tạo mới thành công!' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Lỗi lưu đề thi.' });
    }
});

// [NEW] API Xóa Đề
app.delete('/api/delete-exam/:code', async (req, res) => {
    try {
        const exams = await fs.readJson(EXAMS_FILE);
        const newExams = exams.filter(e => e.code !== req.params.code);
        await fs.writeJson(EXAMS_FILE, newExams);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. Student Join & Check (ĐÃ FIX LỖI CHECK TRÙNG NGƯỜI DÙNG)
app.post('/api/join-exam', async (req, res) => {
    try {
        // [QUAN TRỌNG] Lấy thêm biến 'name' từ request
        const { code, studentId, name } = req.body;
        const exams = await fs.readJson(EXAMS_FILE);
        const exam = exams.find(e => e.code === code);

        if (!exam) return res.status(404).json({ success: false, msg: 'Mã đề không tồn tại!' });

        // CHECK THỜI GIAN
        const now = new Date();
        if (exam.startTime && new Date(exam.startTime) > now) {
            return res.json({ success: false, msg: `Chưa đến giờ thi! Mở lúc: ${new Date(exam.startTime).toLocaleString('vi-VN')}` });
        }
        if (exam.endTime && new Date(exam.endTime) < now) {
            return res.json({ success: false, msg: `Đã hết hạn làm bài! Đóng lúc: ${new Date(exam.endTime).toLocaleString('vi-VN')}` });
        }

        // [LOGIC MỚI] CHECK SỐ LẦN LÀM BÀI (THÔNG MINH HƠN)
        if (exam.maxAttempts > 0) {
            const results = await fs.readJson(RESULTS_FILE);
            
            const attempts = results.filter(r => {
                // Chỉ đếm trong cùng mã đề
                if (r.examCode !== code) return false;

                // TRƯỜNG HỢP 1: Người dùng CÓ nhập MSSV -> Check trùng MSSV
                if (studentId && studentId.trim() !== "") {
                    // Chú ý: convert về string để so sánh cho chắc ăn
                    return String(r.studentId).trim() === String(studentId).trim();
                }
                
                // TRƯỜNG HỢP 2: Người dùng KHÔNG nhập MSSV -> Check trùng Tên
                // (Tránh việc 2 người cùng để trống MSSV bị tính là 1)
                if (name && name.trim() !== "") {
                    return r.studentName.toLowerCase().trim() === name.toLowerCase().trim();
                }

                return false;
            }).length;
            
            if (attempts >= exam.maxAttempts) {
                return res.json({ success: false, msg: `Bạn đã hết lượt làm bài (${attempts}/${exam.maxAttempts})` });
            }
        }

        // ... (Phần clone đề giữ nguyên như cũ) ...
        const examData = { ...exam };
        examData.questions = exam.questions.map(q => {
            let count = q.correctCount || (q.correct ? q.correct.length : 0);
            const { correct, ...rest } = q; 
            return { ...rest, correctCount: count };
        });

        res.json({ success: true, exam: examData });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server Error' });
    }
});
// [ĐÃ SỬA] API Tra cứu điểm (Trả về TOÀN BỘ lịch sử thi)
app.post('/api/check-result', async (req, res) => {
    try {
        const { code, name, studentId } = req.body;
        const results = await fs.readJson(RESULTS_FILE);
        
        // 1. Tìm TẤT CẢ các lần thi khớp thông tin
        const matches = results.filter(r => 
            r.examCode === code && 
            r.studentName.toLowerCase() === name.toLowerCase() &&
            (!studentId || r.studentId === studentId)
        );

        if (matches.length > 0) {
            // 2. Sắp xếp: Mới nhất lên đầu
            matches.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

            // 3. Trả về danh sách
            res.json({ success: true, results: matches });
        } else {
            res.json({ success: false, msg: 'Không tìm thấy bài thi nào phù hợp!' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, msg: 'Lỗi server' });
    }
});
// 4. Submit & Save Result (Kèm Vi Phạm)
app.post('/api/finish-exam', async (req, res) => { // Client gửi API này hoặc qua Socket đều được, ở đây dùng Socket là chính
    res.json({ success: true });
});

// [NEW] API Lấy chi tiết danh sách bài làm của 1 đề
app.get('/api/exam-results/:code', async (req, res) => {
    try {
        const results = await fs.readJson(RESULTS_FILE);
        const examResults = results.filter(r => r.examCode === req.params.code);
        res.json(examResults);
    } catch (e) { res.status(500).json([]); }
});

const studentTimers = {};
// [FIX 1] Thêm biến lưu danh sách học sinh đang online (Bộ nhớ tạm)
const onlineStudents = {}; 
const liveViolations = {}; 
// [MỚI] API NỘP BÀI KHẨN CẤP (Dùng khi Reload/Tắt Tab)
// [ĐÃ SỬA] API NỘP BÀI KHẨN CẤP (Cho phép nộp nhiều lần)
app.post('/api/emergency-submit', async (req, res) => {
    try {
        const { code, answers, studentName, studentId, studentClass } = req.body;
        
        // 1. Đọc đề & Chấm điểm
        const exams = await fs.readJson(EXAMS_FILE);
        const exam = exams.find(e => e.code === code);
        
        let score = 0;
        if(exam) {
            const total = exam.questions.length;
            exam.questions.forEach((q, idx) => {
                const userAns = answers[idx];
                if (!userAns) return;
                let userAnsArr = Array.isArray(userAns) ? userAns : [userAns];
                let correctAnsArr = Array.isArray(q.correct) ? q.correct : [q.correct];

                if (userAnsArr.length === correctAnsArr.length && 
                    JSON.stringify(userAnsArr.sort()) === JSON.stringify(correctAnsArr.sort())) {
                    score += (10 / total);
                }
            });
        }
        score = Math.round(score * 10) / 10;

        // 2. TẠO OBJECT KẾT QUẢ
        const newResult = {
            examCode: code,
            studentName, studentId, studentClass,
            score,
            violations: [{ time: new Date().toLocaleTimeString(), type: "Thoát đột ngột/Reload Tab" }],
            submittedAt: new Date().toISOString(),
            isEmergency: true
        };

        // 3. [QUAN TRỌNG] GỌI HÀM LƯU AN TOÀN
        await saveResultSafe(newResult);

        res.json({ success: true, score });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false });
    }
});
io.on('connection', (socket) => {
    
    // 1. Giáo viên tham gia giám sát
    socket.on('teacher-join', (room) => {
        socket.join(`room-${room}`);
        
        // [FIX 2] Gửi ngay danh sách HS đang có trong phòng cho GV mới vào
        // Giúp GV F5 không bị mất hình học sinh
        Object.values(onlineStudents).forEach(student => {
            if (student.code === room) {
                socket.emit('new-student', student);
            }
        });
    });
    
    // 2. Sinh viên vào phòng thi
    socket.on('student-join', (data) => {
        const room = `room-${data.code}`;
        socket.join(room);
        
        // [FIX 3] Lưu thông tin SV vào bộ nhớ Server
        onlineStudents[socket.id] = {
            id: socket.id,
            name: data.name,
            studentClass: data.studentClass || "---",
            studentId: data.studentId || "---",
            code: data.code
        };

        // Gửi thông báo cho GV
        io.to(room).emit('new-student', onlineStudents[socket.id]);
        
        if (!liveViolations[socket.id]) liveViolations[socket.id] = [];
    });

    // 3. Nhận Stream Camera từ SV -> Gửi cho GV
    socket.on('student-stream-upload', (data) => {
        // data gồm { code, image }
        // Chỉ chuyển tiếp nếu data hợp lệ
        if (data && data.code) {
            socket.to(`room-${data.code}`).emit('student-stream', { 
                id: socket.id, 
                image: data.image 
            });
        }
    });

    // 4. Xử lý cảnh báo vi phạm
    socket.on('cheat-warning', (data) => {
        const room = `room-${data.code}`;
        if(!liveViolations[socket.id]) liveViolations[socket.id] = [];
        liveViolations[socket.id].push({ time: new Date().toLocaleTimeString(), type: data.msg });
        io.to(room).emit('student-violation', { id: socket.id, msg: data.msg });
    });

    // 5. Xử lý nộp bài (ĐÃ SỬA LOGIC CHẤM ĐIỂM)
    socket.on('finish-exam-full', async (payload) => {
        const { code, answers, studentName, studentId, studentClass } = payload;
        
        // Đọc đề để chấm điểm
        const exams = await fs.readJson(EXAMS_FILE);
        const exam = exams.find(e => e.code === code);
        
        let score = 0;
        if(exam) {
            const total = exam.questions.length;
            exam.questions.forEach((q, idx) => {
                const userAns = answers[idx];
                if (!userAns) return;
                let userAnsArr = Array.isArray(userAns) ? userAns : [userAns];
                let correctAnsArr = Array.isArray(q.correct) ? q.correct : [q.correct];

                if (userAnsArr.length === correctAnsArr.length && 
                    JSON.stringify(userAnsArr.sort()) === JSON.stringify(correctAnsArr.sort())) {
                    score += (10 / total);
                }
            });
        }
        score = Math.round(score * 10) / 10;

        // TẠO OBJECT KẾT QUẢ
        const newResult = {
            examCode: code,
            studentName, 
            studentId, 
            studentClass,
            score,
            violations: liveViolations[socket.id] || [],
            submittedAt: new Date().toISOString()
        };

        // [QUAN TRỌNG] GỌI HÀM LƯU AN TOÀN
        await saveResultSafe(newResult);

        // Báo cho 2 bên
        io.to(`room-${code}`).emit('student-finished', { id: socket.id, score });
        socket.emit('exam-result', { score });
    });
    // [ĐÃ SỬA FIX LỖI KHÔNG LƯU ĐƯỢC KHÁNG NGHỊ]
    socket.on('submit-appeal', async (data) => {
        const { code, studentName, reason } = data; // Bỏ studentId ra cho đỡ lỗi
        
        try {
            const results = await fs.readJson(RESULTS_FILE);

            // Tìm bài làm mới nhất khớp Mã Đề và Tên Sinh Viên
            // (Dùng findLastIndex để lấy bài nộp cuối cùng nếu lỡ có nộp nhiều lần)
            const matchIndex = results.findLastIndex(r => 
                r.examCode === code && 
                r.studentName === studentName
            );

            if (matchIndex !== -1) {
                // Lưu kháng nghị vào DB
                results[matchIndex].appeal = {
                    reason: reason,
                    time: new Date().toISOString(),
                    status: 'pending'
                };
                await fs.writeJson(RESULTS_FILE, results);
                
                // [QUAN TRỌNG] Gửi tín hiệu thành công về cho Client
                socket.emit('appeal-success'); 
                
                // Cập nhật ngay cho giáo viên nếu đang xem
                io.emit('update-monitor', { code }); 
            } else {
                console.log("Không tìm thấy bài thi để kháng nghị:", code, studentName);
                socket.emit('appeal-failed', 'Không tìm thấy bài thi của bạn trên hệ thống!');
            }
        } catch (e) {
            console.error(e);
            socket.emit('appeal-failed', 'Lỗi Server khi lưu kháng nghị.');
        }
    });
    // 6. Logic thời gian
    socket.on('request-time', async (data) => {
        const { code } = data;
        const exams = await fs.readJson(EXAMS_FILE);
        const exam = exams.find(e => e.code === code);
        
        let endTime;
        if (exam && exam.endTime) {
            endTime = new Date(exam.endTime).getTime();
        } else {
            const duration = exam ? (parseInt(exam.duration) || 60) : 60;
            endTime = Date.now() + (duration * 60 * 1000);
        }
        socket.emit('server-time-sync', { endTime });
    });

    socket.on('disconnect', () => {
        io.emit('student-left', { id: socket.id });
        delete onlineStudents[socket.id]; // [FIX 4] Xóa SV khi thoát
        delete liveViolations[socket.id]; 
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));