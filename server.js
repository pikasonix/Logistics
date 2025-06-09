const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

// Serve visualizer.html as the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'visualizer.html'));
});

app.post('/solve', (req, res) => {
    const { instance, params } = req.body;
    console.log('POST /solve called'); if (!instance || !params) {
        console.log('Missing instance or params');
        return res.json({ success: false, error: 'Thiếu dữ liệu instance hoặc tham số.' });
    }
    // Tạo dòng tham số cho dòng đầu tiên
    const paramLine = [
        params.num_routes || 10,
        params.ants || 10,
        params.iterations || 20,
        params.alpha || 2.0,
        params.beta || 5.0,
        params.rho || 0.1,
        params.tau_max || 50.0,
        params.tau_min || 0.01,
        params.greedy_bias || 0.85,
        params.elite_solutions || 4,
        params.local_search_prob || 0.7,
        params.restart_threshold || 2
    ].join(' ');

    // Ghi tham số và instance ra file input.txt
    const inputPath = path.join(__dirname, 'public', 'input.txt');
    const fullContent = paramLine + '\n' + instance;
    fs.writeFileSync(inputPath, fullContent, 'utf8');
    console.log('Parameters written to input.txt:', paramLine);

    // Chạy exe không cần tham số vì đã ghi vào file input.txt
    const exePath = path.join(__dirname, 'public', 'PDPTW_HYBRID_ACO_GREEDY_V3.exe');
    console.log('Running exe:', exePath);
    execFile(exePath, [], { cwd: path.join(__dirname, 'public') }, (error, stdout, stderr) => {
        if (error) {
            console.log('Error running exe:', error, stderr);
            return res.json({ success: false, error: stderr || error.message });
        }
        // Đọc kết quả từ output.txt
        const outputPath = path.join(__dirname, 'public', 'output.txt');
        let result = '';
        try {
            result = fs.readFileSync(outputPath, 'utf8');
        } catch (e) {
            console.log('Error reading output.txt:', e);
            return res.json({ success: false, error: 'Không đọc được file output.txt' });
        }
        res.json({ success: true, result });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});