/**
 * 健康记录助手 - 主脚本文件
 * 功能：用户管理、拍照识别、数据存储、历史查看、对比分析
 */

// ==================== OCR配置 ====================
// 支持多种OCR服务，优先使用支持CORS的OCR.space
const OCR_CONFIG = {
    // OCR.space（支持前端直接调用，免费250次/天）
    apiKey: localStorage.getItem('ocr_api_key') || 'helloworld', // 默认免费测试key
    service: 'ocrspace' // ocrspace 或 tencent
};

// 兼容旧的腾讯云配置
const TENCENT_CONFIG = {
    SecretId: localStorage.getItem('tencent_secret_id') || '',
    SecretKey: localStorage.getItem('tencent_secret_key') || '',
    Region: 'ap-guangzhou'
};

// ==================== 数据存储管理 ====================

/**
 * 数据结构说明：
 * {
 *   users: ['妈妈', '爸爸', '自己'],  // 用户列表
 *   currentUser: '妈妈',              // 当前选中的用户
 *   records: {                        // 所有记录，按用户分类
 *     '妈妈': [
 *       {
 *         id: '时间戳',
 *         itemName: '血糖',
 *         value: '5.6',
 *         date: '2024-01-15',
 *         photo: 'base64图片数据',     // 可选
 *         createdAt: 时间戳
 *       }
 *     ]
 *   },
 *   normalRanges: {                   // 正常范围设置
 *     '血糖': { min: 3.9, max: 6.1, unit: 'mmol/L' }
 *   }
 * }
 */

// 存储键名
const STORAGE_KEY = 'healthRecorder_v1';

// 初始化数据
let appData = {
    users: [],
    currentUser: null,
    records: {},
    normalRanges: {
        '血糖': { min: 3.9, max: 6.1, unit: 'mmol/L' },
        '血压': { min: '90/60', max: '120/80', unit: 'mmHg' },
        '体温': { min: 36.0, max: 37.2, unit: '°C' },
        '心率': { min: 60, max: 100, unit: '次/分' }
    }
};

// 当前状态
let currentState = {
    capturedPhoto: null,      // 当前拍摄的照片
    recognizedData: null,     // OCR识别的结果
    compareMode: false,       // 是否在对面对比模式
    selectedRecords: []       // 选中的记录ID
};

// ==================== 初始化 ====================

// 页面加载时执行
document.addEventListener('DOMContentLoaded', function() {
    loadData();
    initApp();
});

// 从本地存储加载数据
function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // 合并默认数据和保存的数据
            appData = { ...appData, ...parsed };
        } catch (e) {
            console.error('数据加载失败', e);
        }
    }
}

// 保存数据到本地存储
function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
        // 如果存储失败（可能是满了），尝试清理照片后重新保存
        if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
            console.warn('存储空间不足，正在清理照片数据...');

            // 清理所有记录中的照片
            Object.keys(appData.records).forEach(user => {
                appData.records[user].forEach(record => {
                    delete record.photo; // 删除照片字段
                });
            });

            // 再次尝试保存
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                console.log('清理后保存成功');
            } catch (e2) {
                // 如果还是失败，可能是数据实在太多，提醒用户
                alert('存储空间已满，请删除一些旧记录后再保存。');
                throw e2;
            }
        } else {
            throw e;
        }
    }
}

// 初始化应用
function initApp() {
    // 如果有用户，显示用户选择页
    // 如果没有用户，也显示用户选择页（提示添加）
    showPage('page-user-select');
    renderUserList();

    // 设置日期输入框默认值为今天
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('record-date').value = today;

    // 绑定摄像头选择事件
    document.getElementById('camera-input').addEventListener('change', handlePhotoCapture);

    // 添加重置按钮（长按切换用户按钮5秒）
    const backBtn = document.querySelector('.btn-back');
    if (backBtn) {
        let pressTimer;
        backBtn.addEventListener('mousedown', () => {
            pressTimer = setTimeout(() => {
                if (confirm('确定要重置应用吗？所有数据将被清空！')) {
                    resetApp();
                }
            }, 3000);
        });
        backBtn.addEventListener('mouseup', () => clearTimeout(pressTimer));
        backBtn.addEventListener('mouseleave', () => clearTimeout(pressTimer));
    }
}

// 重置应用（清空所有数据）
function resetApp() {
    localStorage.removeItem(STORAGE_KEY);
    appData = {
        users: [],
        currentUser: null,
        records: {},
        normalRanges: {
            '血糖': { min: 3.9, max: 6.1, unit: 'mmol/L' },
            '血压': { min: '90/60', max: '120/80', unit: 'mmHg' },
            '体温': { min: 36.0, max: 37.2, unit: '°C' },
            '心率': { min: 60, max: 100, unit: '次/分' }
        }
    };
    alert('应用已重置！');
    location.reload();
}

// ==================== 页面切换 ====================

function showPage(pageId) {
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    // 显示指定页面
    document.getElementById(pageId).classList.add('active');
}

// ==================== 用户管理 ====================

// 渲染用户列表
function renderUserList() {
    const container = document.getElementById('user-list');

    if (appData.users.length === 0) {
        container.innerHTML = '<p class="empty-tip">还没有添加家人，点击下方按钮添加</p>';
        return;
    }

    container.innerHTML = appData.users.map(user => `
        <button class="user-btn" onclick="selectUser('${user}')">
            <span class="avatar">👤</span>
            <span>${user}</span>
        </button>
    `).join('');
}

// ==================== 设置OCR ====================

let currentOCRTab = 'free';

// 切换OCR设置标签
function switchOCRTab(tab) {
    currentOCRTab = tab;

    // 切换按钮样式
    document.querySelectorAll('.ocr-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 切换面板
    document.getElementById('ocr-free-panel').classList.toggle('active', tab === 'free');
    document.getElementById('ocr-tencent-panel').classList.toggle('active', tab === 'tencent');
}

// 显示设置弹窗
function showSettings() {
    const modal = document.getElementById('modal-settings');

    // 填入当前保存的设置
    const useFree = localStorage.getItem('use_free_ocr') !== 'false';
    document.getElementById('use-free-ocr').checked = useFree;
    document.getElementById('settings-secret-id').value = localStorage.getItem('tencent_secret_id') || '';
    document.getElementById('settings-secret-key').value = localStorage.getItem('tencent_secret_key') || '';

    modal.classList.add('active');
}

// 隐藏设置弹窗
function hideSettings() {
    document.getElementById('modal-settings').classList.remove('active');
}

// 保存设置
function saveSettings() {
    const useFreeOCR = document.getElementById('use-free-ocr').checked;
    const secretId = document.getElementById('settings-secret-id').value.trim();
    const secretKey = document.getElementById('settings-secret-key').value.trim();

    // 保存到本地存储
    localStorage.setItem('use_free_ocr', useFreeOCR);

    if (secretId && secretKey) {
        localStorage.setItem('tencent_secret_id', secretId);
        localStorage.setItem('tencent_secret_key', secretKey);
        TENCENT_CONFIG.SecretId = secretId;
        TENCENT_CONFIG.SecretKey = secretKey;
    }

    // 更新配置
    OCR_CONFIG.apiKey = useFreeOCR ? 'helloworld' : '';

    if (useFreeOCR) {
        alert('已启用免费OCR服务！每天可识别250次。');
    } else if (secretId && secretKey) {
        alert('已启用腾讯云OCR！');
    } else {
        alert('设置已保存');
    }

    hideSettings();
}

// 显示添加用户弹窗
function showAddUser() {
    document.getElementById('modal-add-user').classList.add('active');
    document.getElementById('new-username').value = '';
    document.getElementById('new-username').focus();
}

// 隐藏添加用户弹窗
function hideAddUser() {
    document.getElementById('modal-add-user').classList.remove('active');
}

// 添加用户
function addUser() {
    const input = document.getElementById('new-username');
    const name = input.value.trim();

    if (!name) {
        alert('请输入姓名');
        return;
    }

    if (appData.users.includes(name)) {
        alert('该用户已存在');
        return;
    }

    // 添加到用户列表
    appData.users.push(name);
    // 初始化该用户的记录数组
    appData.records[name] = [];
    // 保存
    saveData();
    // 刷新列表
    renderUserList();
    // 关闭弹窗
    hideAddUser();
}

// 选择用户
function selectUser(userName) {
    appData.currentUser = userName;
    saveData();

    // 更新主页显示的用户名
    document.getElementById('current-user-name').textContent = userName;

    // 渲染最近记录
    renderRecentRecords();

    // 切换到主页面
    showPage('page-main');
}

// 返回用户选择页
function backToUserSelect() {
    showPage('page-user-select');
    renderUserList();
}

// ==================== 拍照功能 ====================

// 打开摄像头
function openCamera() {
    document.getElementById('camera-input').click();
}

// 处理拍摄的照片
function handlePhotoCapture(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 显示加载中
    showLoading(true);

    // 读取图片
    const reader = new FileReader();
    reader.onload = function(e) {
        const photoData = e.target.result;
        currentState.capturedPhoto = photoData;

        // 显示预览
        document.getElementById('preview-image').src = photoData;

        // 模拟OCR识别（实际使用时替换为真实API调用）
        simulateOCR(photoData);
    };
    reader.readAsDataURL(file);

    // 清空input，允许重复选择同一文件
    event.target.value = '';
}

// OCR识别主函数
async function simulateOCR(photoData) {
    try {
        showLoading(true);

        // 优先使用 OCR.space（支持CORS）
        console.log('尝试使用 OCR.space 识别...');
        const result = await callOCRSpace(photoData);

        if (result && result.length > 0) {
            currentState.recognizedData = result;
            renderRecognizedItems(result);
            showPage('page-result');
        } else {
            throw new Error('未能识别出内容');
        }

    } catch (error) {
        console.error('OCR识别失败:', error);

        // 如果OCR.space失败，尝试腾讯云（如果配置了）
        if (TENCENT_CONFIG.SecretId && TENCENT_CONFIG.SecretKey) {
            console.log('尝试使用腾讯云OCR...');
            try {
                await callTencentOCR(photoData);
                return;
            } catch (tencentError) {
                console.error('腾讯云OCR也失败:', tencentError);
            }
        }

        // 都失败了，使用模拟数据
        alert('OCR识别失败，将使用模拟数据。您可以手动修改识别结果。\n错误：' + error.message);
        simulateOCRMock(photoData);
    } finally {
        showLoading(false);
    }
}

// 模拟OCR识别（用于测试）
function simulateOCRMock(photoData) {
    setTimeout(() => {
        showLoading(false);

        const recognizedItems = [
            { itemName: '血糖', value: (Math.random() * 3 + 4).toFixed(1), reference: '3.9-6.1' },
            { itemName: '血压', value: `${Math.floor(Math.random() * 30 + 110)}/${Math.floor(Math.random() * 20 + 70)}`, reference: '90-140/60-90' },
            { itemName: '总胆固醇', value: (Math.random() * 2 + 3).toFixed(2), reference: '2.8-5.2' },
            { itemName: '甘油三酯', value: (Math.random() * 3 + 0.5).toFixed(2), reference: '0.4-1.7' },
            { itemName: '尿酸', value: Math.floor(Math.random() * 200 + 200).toString(), reference: '150-420' }
        ];

        currentState.recognizedData = recognizedItems;
        renderRecognizedItems(recognizedItems);
        showPage('page-result');

    }, 1500);
}

// 调用 OCR.space（支持CORS，有免费额度）
async function callOCRSpace(photoData) {
    // 压缩图片以减小体积
    const compressedImage = await compressImage(photoData, 800, 0.7);

    const formData = new FormData();
    formData.append('base64Image', compressedImage);
    formData.append('language', 'chs'); // 中文简体
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');

    const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (result.IsErroredOnProcessing) {
        throw new Error(result.ErrorMessage || 'OCR识别失败');
    }

    if (!result.ParsedResults || result.ParsedResults.length === 0) {
        throw new Error('未识别出文字');
    }

    // 合并所有识别结果
    const fullText = result.ParsedResults.map(r => r.ParsedText).join(' ');
    console.log('OCR识别原文：', fullText);

    // 解析识别结果
    return parseOCRResultFromText(fullText);
}

// 压缩图片
async function compressImage(dataUrl, maxWidth, quality) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // 等比缩放
            if (width > maxWidth) {
                height = Math.round(height * maxWidth / width);
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

// 从文本解析检查项目
function parseOCRResultFromText(text) {
    const items = [];

    // 常见医学检查项目识别模式
    const patterns = [
        { name: '血糖', regex: /(?:血糖|GLU|葡萄糖)[^\d]*(\d+\.?\d*)/i, ref: '3.9-6.1' },
        { name: '血压', regex: /(?:血压|BP)[^\d]*(\d{2,3})\s*[\/\-]?\s*(\d{2,3})/i, ref: '90-140/60-90', isRatio: true },
        { name: '总胆固醇', regex: /(?:总胆固醇|CHO|TC)[^\d]*(\d+\.?\d*)/i, ref: '2.8-5.2' },
        { name: '甘油三酯', regex: /(?:甘油三酯|TG)[^\d]*(\d+\.?\d*)/i, ref: '0.4-1.7' },
        { name: '尿酸', regex: /(?:尿酸|UA)[^\d]*(\d+)/i, ref: '150-420' },
        { name: '血红蛋白', regex: /(?:血红蛋白|HGB)[^\d]*(\d+)/i, ref: '120-160' },
        { name: '白细胞', regex: /(?:白细胞|WBC)[^\d]*(\d+\.?\d*)/i, ref: '4-10' },
        { name: '血小板', regex: /(?:血小板|PLT)[^\d]*(\d+)/i, ref: '100-300' },
        { name: '肌酐', regex: /(?:肌酐|CREA)[^\d]*(\d+)/i, ref: '44-133' },
        { name: '尿素氮', regex: /(?:尿素氮|BUN)[^\d]*(\d+\.?\d*)/i, ref: '2.6-7.5' }
    ];

    patterns.forEach(pattern => {
        const match = text.match(pattern.regex);
        if (match) {
            const value = pattern.isRatio ? `${match[1]}/${match[2]}` : match[1];
            items.push({
                itemName: pattern.name,
                value: value,
                reference: pattern.ref
            });
        }
    });

    // 如果没识别出任何项目，尝试提取所有数字作为备选
    if (items.length === 0) {
        const numbers = text.match(/\d+\.?\d*/g);
        if (numbers && numbers.length > 0) {
            items.push({
                itemName: '未识别项目',
                value: numbers[0],
                reference: ''
            });
        }
    }

    return items.length > 0 ? items : [{ itemName: '未识别', value: '请手动输入', reference: '' }];
}

// 调用腾讯云真实OCR
async function callTencentOCR(photoData) {
    try {
        // 提取base64图片数据（去掉 data:image/jpeg;base64, 前缀）
        const base64Image = photoData.split(',')[1];

        // 生成签名
        const timestamp = Math.floor(Date.now() / 1000);
        const date = new Date().toISOString().split('T')[0];

        // 构建请求参数
        const payload = JSON.stringify({
            ImageBase64: base64Image
        });

        // 计算签名（简化版，使用TC3-HMAC-SHA256）
        const signature = await generateTencentSignature(payload, timestamp, date);

        // 调用API
        const response = await fetch('https://ocr.tencentcloudapi.com', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Host': 'ocr.tencentcloudapi.com',
                'X-TC-Action': 'GeneralBasicOCR',
                'X-TC-Version': '2018-11-19',
                'X-TC-Timestamp': timestamp.toString(),
                'X-TC-Region': TENCENT_CONFIG.Region,
                'Authorization': signature
            },
            body: payload
        });

        const result = await response.json();

        if (result.Response && result.Response.TextDetections) {
            // 解析识别结果
            const recognizedItems = parseOCRResult(result.Response.TextDetections);
            currentState.recognizedData = recognizedItems;
            renderRecognizedItems(recognizedItems);
            showPage('page-result');
        } else if (result.Response && result.Response.Error) {
            throw new Error(result.Response.Error.Message);
        } else {
            throw new Error('识别失败，请重试');
        }

    } catch (error) {
        console.error('OCR识别失败:', error);
        alert('OCR识别失败: ' + error.message + '\n将使用模拟数据');
        simulateOCRMock(photoData);
    } finally {
        showLoading(false);
    }
}

// 生成腾讯云签名（TC3-HMAC-SHA256）
async function generateTencentSignature(payload, timestamp, date) {
    const service = 'ocr';
    const secretId = TENCENT_CONFIG.SecretId;
    const secretKey = TENCENT_CONFIG.SecretKey;

    // 1. 构建规范请求
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json\nhost:ocr.tencentcloudapi.com\n`;
    const signedHeaders = 'content-type;host';

    const payloadHash = await sha256(payload);
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // 2. 构建待签名字符串
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = await sha256(canonicalRequest);
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    // 3. 计算签名
    const secretDate = await hmacSha256(`TC3${secretKey}`, date);
    const secretService = await hmacSha256(secretDate, service);
    const secretSigning = await hmacSha256(secretService, 'tc3_request');
    const signature = await hmacSha256Hex(secretSigning, stringToSign);

    // 4. 构建Authorization
    return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// SHA256哈希
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256（返回ArrayBuffer）
async function hmacSha256(key, message) {
    const keyBuffer = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const msgBuffer = new TextEncoder().encode(message);

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    return crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
}

// HMAC-SHA256（返回Hex字符串）
async function hmacSha256Hex(key, message) {
    const signature = await hmacSha256(key, message);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 解析OCR识别结果，提取项目、数值、参考值
function parseOCRResult(detections) {
    const items = [];
    const texts = detections.map(d => d.DetectedText);

    // 合并所有文本
    const fullText = texts.join(' ');

    // 常见医学检查项目识别模式
    const patterns = [
        // 血糖 5.6 mmol/L 参考值: 3.9-6.1
        /(血糖|GLU)[\s:：]*(\d+\.?\d*)\s*(mmol\/L)?[^\d]*(?:参考值|Ref)?[^\d]*(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/i,

        // 血压 120/80 mmHg
        /(血压|BP)[\s:：]*(\d{2,3})\s*[\/]\s*(\d{2,3})/i,

        // 总胆固醇 4.2 mmol/L
        /(总胆固醇|CHO|TC)[\s:：]*(\d+\.?\d*)/i,

        // 甘油三酯 1.2 mmol/L
        /(甘油三酯|TG)[\s:：]*(\d+\.?\d*)/i,

        // 尿酸 320 umol/L
        /(尿酸|UA)[\s:：]*(\d+)/i,

        // 血红蛋白 130 g/L
        /(血红蛋白|HGB)[\s:：]*(\d+)/i,

        // 白细胞 7.5 10^9/L
        /(白细胞|WBC)[\s:：]*(\d+\.?\d*)/i,

        // 血小板 250 10^9/L
        /(血小板|PLT)[\s:：]*(\d+)/i
    ];

    // 尝试匹配每种模式
    patterns.forEach(pattern => {
        const match = fullText.match(pattern);
        if (match) {
            const itemName = match[1];
            let value, reference;

            if (itemName.includes('血压')) {
                value = `${match[2]}/${match[3]}`;
                reference = '90-140/60-90';
            } else if (itemName.includes('血糖')) {
                value = match[2];
                reference = match[4] && match[5] ? `${match[4]}-${match[5]}` : '3.9-6.1';
            } else {
                value = match[2];
                reference = '';
            }

            items.push({
                itemName: itemName,
                value: value,
                reference: reference
            });
        }
    });

    // 如果没识别出任何项目，返回一个通用提示
    if (items.length === 0) {
        items.push({
            itemName: '未识别项目',
            value: '请手动输入',
            reference: ''
        });
    }

    return items;
}

// 渲染识别出的项目列表
function renderRecognizedItems(items) {
    const container = document.getElementById('recognized-items-list');

    if (!container) {
        // 如果容器不存在，创建它
        createRecognizedItemsContainer();
        return renderRecognizedItems(items);
    }

    // 更新项目计数
    const countSpan = document.getElementById('item-count');
    if (countSpan) {
        countSpan.textContent = `识别出 ${items.length} 个项目`;
    }

    // 分离正常和异常项目
    const abnormalItems = [];
    const normalItems = [];

    items.forEach((item, index) => {
        const status = checkValueStatus(item.value, item.reference);
        if (status !== 'normal') {
            abnormalItems.push({ ...item, index, status });
        } else {
            normalItems.push({ ...item, index, status });
        }
    });

    // 显示异常值提醒（如果有）
    const abnormalHint = document.getElementById('abnormal-hint');
    if (abnormalHint) {
        if (abnormalItems.length > 0) {
            const itemNames = abnormalItems.map(i => i.itemName).join('、');
            abnormalHint.innerHTML = `⚠️ <b>注意：</b>${itemNames} 共 ${abnormalItems.length} 项指标异常，请关注！`;
            abnormalHint.className = 'abnormal-hint active';
        } else {
            abnormalHint.className = 'abnormal-hint';
        }
    }

    // 渲染所有项目（异常的放前面）
    const allItems = [...abnormalItems, ...normalItems];

    container.innerHTML = allItems.map(({ itemName, value, reference, index, status }) => `
        <div class="recognized-item ${status !== 'normal' ? 'abnormal' : ''}" data-index="${index}">
            <input type="checkbox" class="item-checkbox" checked data-index="${index}">
            <div class="item-content">
                <div class="item-row">
                    <input type="text" class="item-name-input" value="${itemName}" placeholder="项目名称">
                    <span class="status-badge ${status}">${getStatusText(status)}</span>
                </div>
                <div class="item-row values-row">
                    <div class="input-group">
                        <label>数值</label>
                        <input type="text" class="item-value-input" value="${value}" placeholder="数值">
                    </div>
                    <div class="input-group">
                        <label>参考值</label>
                        <input type="text" class="item-reference-input" value="${reference || ''}" placeholder="如: 3.9-6.1">
                    </div>
                </div>
                <div class="item-hint" id="hint-${index}"></div>
            </div>
        </div>
    `).join('');

    // 为每个项目显示对比提示
    items.forEach((item, index) => {
        showCompareHintForItem(item.itemName, item.value, index);
    });
}

// 解析参考范围字符串，返回对象格式
function parseReferenceRange(itemName, referenceStr) {
    // 空值保护
    if (!referenceStr || typeof referenceStr !== 'string') {
        return { raw: referenceStr };
    }

    // 处理如 "3.9-6.1" 或 "90-140/60-90"
    const parts = referenceStr.split('/');

    if (parts.length === 2) {
        // 双值范围（如血压）
        const firstRange = parts[0].match(/([\d.]+)\s*-\s*([\d.]+)/);
        const secondRange = parts[1].match(/([\d.]+)\s*-\s*([\d.]+)/);

        if (firstRange && secondRange) {
            return {
                min: parseFloat(firstRange[1]),
                max: parseFloat(firstRange[2]),
                min2: parseFloat(secondRange[1]),
                max2: parseFloat(secondRange[2]),
                unit: '',
                raw: referenceStr
            };
        }
    } else {
        // 单值范围
        const match = referenceStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (match) {
            return {
                min: parseFloat(match[1]),
                max: parseFloat(match[2]),
                unit: '',
                raw: referenceStr
            };
        }
    }

    return { raw: referenceStr };
}

// 检查数值状态（正常/偏高/偏低）
function checkValueStatus(value, reference) {
    // 空值保护
    if (!reference || !value) return 'unknown';

    // 尝试解析数值和参考范围
    const val = parseFloat(value);
    if (isNaN(val)) return 'unknown';

    // 处理参考范围，如 "3.9-6.1" 或 "90-140/60-90"
    // 只取第一个范围（血压只判断收缩压）
    const firstRange = reference.split('/')[0];
    const match = firstRange.match(/([\d.]+)\s*-\s*([\d.]+)/);

    if (!match) return 'unknown';

    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);

    if (isNaN(min) || isNaN(max)) return 'unknown';

    if (val > max) return 'high';
    if (val < min) return 'low';
    return 'normal';
}

// 获取状态文字
function getStatusText(status) {
    const statusMap = {
        'normal': '✓ 正常',
        'high': '↑ 偏高',
        'low': '↓ 偏低',
        'unknown': '? 未知'
    };
    return statusMap[status] || '未知';
}

// 全选/取消全选
function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.recognized-item .item-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
    });
}

// 创建识别项目列表容器（如果不存在）
function createRecognizedItemsContainer() {
    const form = document.querySelector('.result-form');

    // 创建容器
    const container = document.createElement('div');
    container.id = 'recognized-items-list';
    container.className = 'recognized-items-list';

    // 插入到表单最前面
    form.insertBefore(container, form.firstChild);
}

// 显示单个项目的对比提示（用于多项目列表）
function showCompareHintForItem(itemName, currentValue, index) {
    try {
        const user = appData.currentUser;
        const hintDiv = document.getElementById(`hint-${index}`);
        if (!hintDiv) return;

        if (!user || !appData.records[user]) {
            hintDiv.innerHTML = '📌 首次记录';
            return;
        }

        // 找该项目的上次记录
        const userRecords = appData.records[user];
        const sameItemRecords = userRecords.filter(r => r.itemName === itemName);

        if (sameItemRecords.length === 0) {
            hintDiv.innerHTML = '📌 首次记录';
            return;
        }

        // 获取最新的一条（按创建时间排序）
        const lastRecord = sameItemRecords.sort((a, b) => b.createdAt - a.createdAt)[0];
        const lastValue = lastRecord.value;

    // 比较数值
    let changeText = '';
    let colorClass = '';

    if (currentValue > lastValue) {
        changeText = `↗️ 比上次${lastValue}升高`;
        colorClass = 'up';
    } else if (currentValue < lastValue) {
        changeText = `↘️ 比上次${lastValue}降低`;
        colorClass = 'down';
    } else {
        changeText = `➡️ 与上次持平`;
        colorClass = 'same';
    }

    // 检查是否在正常范围
    const range = appData.normalRanges[itemName];
    let rangeWarning = '';

    if (range) {
        const val = parseFloat(currentValue);
        if (!isNaN(val)) {
            if (val > range.max || val < range.min) {
                rangeWarning = ' ⚠️<b>超出正常范围</b>';
            }
        }
    }

    hintDiv.innerHTML = changeText + rangeWarning;
    hintDiv.className = 'item-hint ' + colorClass;
    } catch (e) {
        console.error('显示对比提示出错:', e);
    }
}

// 显示对比提示（与上次记录比较）- 旧版本兼容
function showCompareHint(itemName, currentValue) {
    // 现在用不到了，每个项目单独显示提示
    const hintDiv = document.getElementById('compare-hint');
    if (hintDiv) {
        hintDiv.style.display = 'none';
    }
}

// ==================== 记录保存（多项目版本） ====================

function saveRecord() {
    try {
        const recordDate = document.getElementById('record-date').value;
        const user = appData.currentUser;

        if (!user) {
            alert('请先选择用户');
            return;
        }

        // 获取所有勾选的项目
        const checkedItems = [];
        document.querySelectorAll('.recognized-item').forEach(itemDiv => {
            const checkbox = itemDiv.querySelector('.item-checkbox');
            if (checkbox && checkbox.checked) {
                const nameInput = itemDiv.querySelector('.item-name-input');
                const valueInput = itemDiv.querySelector('.item-value-input');
                const referenceInput = itemDiv.querySelector('.item-reference-input');

                const itemName = nameInput.value.trim();
                const itemValue = valueInput.value.trim();
                const reference = referenceInput ? referenceInput.value.trim() : '';

                if (itemName && itemValue) {
                    checkedItems.push({
                        itemName: itemName,
                        value: itemValue,
                        reference: reference
                    });
                }
            }
        });

        if (checkedItems.length === 0) {
            alert('请至少选择一项保存');
            return;
        }

        // 初始化用户记录数组
        if (!appData.records[user]) {
            appData.records[user] = [];
        }

        // 为每个选中的项目创建记录
        const baseTime = Date.now();
        checkedItems.forEach((item, index) => {
            const record = {
                id: (baseTime + index).toString(),
                itemName: item.itemName,
                value: item.value,
                reference: item.reference,
                date: recordDate || new Date().toISOString().split('T')[0],
                // photo 字段暂时不保存（避免超出存储限制）
                createdAt: baseTime + index
            };
            appData.records[user].push(record);

            // 更新全局参考值库（方便以后自动填充）
            if (item.reference) {
                try {
                    appData.normalRanges[item.itemName] = parseReferenceRange(item.itemName, item.reference);
                } catch (e) {
                    console.warn('解析参考范围失败:', item.reference, e);
                }
            }
        });

        // 保存到本地存储
        saveData();

        // 提示成功
        alert(`成功保存 ${checkedItems.length} 条记录！`);

        // 返回主页面
        backToMain();
    } catch (e) {
        console.error('保存记录出错:', e);
        alert('保存失败: ' + e.message);
    }
}

// 返回主页
function backToMain() {
    showPage('page-main');
    renderRecentRecords();

    // 清空当前状态
    currentState.capturedPhoto = null;
    currentState.recognizedData = null;

    // 清空识别项目列表（如果存在）
    const itemsList = document.getElementById('recognized-items-list');
    if (itemsList) {
        itemsList.innerHTML = '';
    }

    // 清空异常提示
    const abnormalHint = document.getElementById('abnormal-hint');
    if (abnormalHint) {
        abnormalHint.className = 'abnormal-hint';
    }
}

// ==================== 搜索过滤 ====================

let currentSearchTerm = '';

function filterRecords() {
    const input = document.getElementById('search-input');
    currentSearchTerm = input ? input.value.trim().toLowerCase() : '';
    renderRecentRecords();
}

// ==================== 最近记录渲染 ====================
// 主页只显示每种项目的最新一条记录（去重），点击可查看该项目所有历史

function renderRecentRecords() {
    const user = appData.currentUser;
    const container = document.getElementById('recent-list');

    if (!user || !appData.records[user] || appData.records[user].length === 0) {
        container.innerHTML = '<p class="empty-tip">暂无记录，点击上方按钮拍照</p>';
        return;
    }

    // 按项目名称分组，只保留每个项目的最新记录
    const latestRecordsMap = new Map();

    appData.records[user].forEach(record => {
        const existing = latestRecordsMap.get(record.itemName);
        // 如果还没有这个项目的记录，或者当前记录更新，则更新
        if (!existing || record.createdAt > existing.createdAt) {
            latestRecordsMap.set(record.itemName, record);
        }
    });

    // 转换为数组，按创建时间倒序排列（最新的项目在前）
    let recent = Array.from(latestRecordsMap.values())
        .sort((a, b) => b.createdAt - a.createdAt);

    // 应用搜索过滤
    if (currentSearchTerm) {
        recent = recent.filter(r =>
            r.itemName.toLowerCase().includes(currentSearchTerm)
        );
    }

    container.innerHTML = recent.map(record => {
        // 检查状态
        const status = checkValueStatus(record.value, record.reference);
        const statusBadge = status !== 'normal' && status !== 'unknown'
            ? `<span class="record-status ${status}">${getStatusText(status)}</span>`
            : '';

        return `
        <div class="record-item" onclick="showItemDetail('${record.itemName}')">
            <div class="record-info">
                <div class="record-name">${record.itemName} ${statusBadge}</div>
                <div class="record-date">最新: ${record.date}</div>
            </div>
            <div class="record-value">${record.value}</div>
        </div>
    `}).join('');
}

// ==================== 项目详情页 ====================

let currentDetailItem = null;

function showItemDetail(itemName) {
    currentDetailItem = itemName;
    document.getElementById('detail-item-name').textContent = itemName;

    const user = appData.currentUser;
    const records = (appData.records[user] || [])
        .filter(r => r.itemName === itemName)
        .sort((a, b) => b.createdAt - a.createdAt); // 按创建时间倒序（最新的在前）

    // 更新统计
    document.getElementById('record-count').textContent = records.length;
    document.getElementById('latest-value').textContent =
        records.length > 0 ? records[0].value : '-'; // 第一条就是最新的

    // 渲染历史列表
    renderHistoryList(records);

    // 重置对比模式
    cancelCompare();

    // 显示详情页
    showPage('page-detail');
}

function renderHistoryList(records) {
    const container = document.getElementById('history-list');

    if (records.length === 0) {
        container.innerHTML = '<p class="empty-tip">暂无记录</p>';
        return;
    }

    container.innerHTML = records.map((record, index) => {
        // 计算与下一条（更旧的）的变化
        let changeHtml = '';
        if (index < records.length - 1) {
            const nextValue = records[index + 1].value; // 下一条是更旧的
            const currValue = record.value;

            // 和旧值比较：当前 > 旧值 = 升高，当前 < 旧值 = 降低
            if (currValue > nextValue) {
                changeHtml = '<span class="value-change change-up">↗️ 升</span>';
            } else if (currValue < nextValue) {
                changeHtml = '<span class="value-change change-down">↘️ 降</span>';
            } else {
                changeHtml = '<span class="value-change change-same">➡️ 平</span>';
            }
        } else {
            // 最后一条（最旧的）显示 "最早"
            changeHtml = '<span class="value-change">📌 最早</span>';
        }

        const checkboxHtml = currentState.compareMode
            ? `<input type="checkbox" value="${record.id}" onchange="toggleRecordSelection('${record.id}')">`
            : '';

        return `
            <div class="history-item">
                ${checkboxHtml}
                <div class="item-content">
                    <div class="item-date">${record.date}</div>
                    <div class="item-value">${record.value} ${changeHtml}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== 多选对比功能 ====================

function toggleCompareMode() {
    currentState.compareMode = !currentState.compareMode;
    currentState.selectedRecords = [];

    const bar = document.getElementById('compare-bar');

    if (currentState.compareMode) {
        bar.style.display = 'flex';
    } else {
        bar.style.display = 'none';
    }

    // 重新渲染列表（显示/隐藏复选框）- 倒序排列
    const user = appData.currentUser;
    const records = (appData.records[user] || [])
        .filter(r => r.itemName === currentDetailItem)
        .sort((a, b) => b.createdAt - a.createdAt);

    renderHistoryList(records);
}

function toggleRecordSelection(recordId) {
    const index = currentState.selectedRecords.indexOf(recordId);

    if (index > -1) {
        currentState.selectedRecords.splice(index, 1);
    } else {
        currentState.selectedRecords.push(recordId);
    }

    document.getElementById('selected-count').textContent = currentState.selectedRecords.length;
}

function cancelCompare() {
    currentState.compareMode = false;
    currentState.selectedRecords = [];
    document.getElementById('compare-bar').style.display = 'none';
    document.getElementById('selected-count').textContent = '0';
}

function doCompare() {
    if (currentState.selectedRecords.length < 2) {
        alert('请至少选择2条记录进行对比');
        return;
    }

    const user = appData.currentUser;
    const allRecords = appData.records[user] || [];

    // 获取选中的记录详情，按日期正序排列（从旧到新，便于看变化趋势）
    const selected = currentState.selectedRecords
        .map(id => allRecords.find(r => r.id === id))
        .filter(r => r)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // 生成对比表格
    const tableHtml = `
        <table class="compare-table">
            <thead>
                <tr>
                    <th>日期</th>
                    <th>数值</th>
                    <th>较上次</th>
                </tr>
            </thead>
            <tbody>
                ${selected.map((record, index) => {
                    let change = '-';
                    if (index > 0) {
                        const prev = selected[index - 1].value;
                        const curr = record.value;
                        if (curr > prev) change = '↗️ 升高';
                        else if (curr < prev) change = '↘️ 降低';
                        else change = '➡️ 持平';
                    }
                    return `
                        <tr>
                            <td>${record.date}</td>
                            <td><b>${record.value}</b></td>
                            <td>${change}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    document.getElementById('compare-result').innerHTML = tableHtml;
    document.getElementById('modal-compare').classList.add('active');
}

function closeCompare() {
    document.getElementById('modal-compare').classList.remove('active');
}

// ==================== 趋势图功能 ====================

let trendChart = null;

function showTrendChart() {
    const user = appData.currentUser;
    const records = (appData.records[user] || [])
        .filter(r => r.itemName === currentDetailItem)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (records.length < 2) {
        alert('至少需要2条记录才能显示趋势图');
        return;
    }

    // 准备图表数据
    const labels = records.map(r => r.date);
    const data = records.map(r => {
        // 尝试提取数值（处理如 "120/80" 的情况，取第一个数）
        const val = r.value.toString().split('/')[0];
        return parseFloat(val) || 0;
    });

    // 销毁旧图表
    if (trendChart) {
        trendChart.destroy();
    }

    // 创建新图表
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: currentDetailItem,
                data: data,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 3,
                pointRadius: 5,
                pointBackgroundColor: '#667eea',
                fill: true,
                tension: 0.3  // 曲线平滑度
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: { size: 14 }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        font: { size: 12 }
                    }
                },
                x: {
                    ticks: {
                        font: { size: 12 }
                    }
                }
            }
        }
    });

    document.getElementById('modal-chart').classList.add('active');
}

function closeChart() {
    document.getElementById('modal-chart').classList.remove('active');
}

// ==================== 工具函数 ====================

function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.add('active');
    } else {
        loading.classList.remove('active');
    }
}

// 键盘事件 - 在添加用户弹窗按回车确认
document.getElementById('new-username').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        addUser();
    }
});

// 点击弹窗外部关闭弹窗
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });
});
