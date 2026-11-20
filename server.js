const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(__dirname, '.local-data');
const SETTINGS_FILE = path.join(LOCAL_DATA_DIR, 'settings.json');
const LOGS_FILE = path.join(LOCAL_DATA_DIR, 'logs.json');
const COOKIE_NAME = 'xunji_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function ensureLocalDataDir() {
  if (!fs.existsSync(LOCAL_DATA_DIR)) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  }
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'Xunji@CCNU2026!';
}

function safeEqual(a, b) {
  const dA = crypto.createHash('sha256').update(String(a || '')).digest();
  const dB = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(dA, dB);
}

function signToken(expiresMs) {
  return crypto
    .createHmac('sha256', `${getAdminPassword()}:xunji-admin-v1`)
    .update(String(expiresMs))
    .digest('hex');
}

function parseCookies(header) {
  const map = {};
  if (!header) return map;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) map[k] = v;
  }
  return map;
}

function isAdminRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expiresMs = Number(parts[0]);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false;
  return safeEqual(parts[1], signToken(expiresMs));
}

function createAdminCookie() {
  const expiresMs = Date.now() + SESSION_TTL_MS;
  const token = `${expiresMs}.${signToken(expiresMs)}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearAdminCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function getAdminSettings() {
  const defaults = {
    providerName: 'deepseek',
    apiBaseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    textModel: 'deepseek-chat',
    visionModel: 'deepseek-flash',
    aiEnabled: true,
    visitorPasscode: '',
    updatedAt: null
  };
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return defaults;
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const legacyKey = typeof raw.deepseekApiKey === 'string' ? raw.deepseekApiKey : '';
    return {
      providerName: typeof raw.providerName === 'string' && raw.providerName.trim() ? raw.providerName.trim() : defaults.providerName,
      apiBaseUrl: typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl.trim() ? raw.apiBaseUrl.trim() : defaults.apiBaseUrl,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : legacyKey,
      textModel: typeof raw.textModel === 'string' && raw.textModel.trim() ? raw.textModel.trim() : defaults.textModel,
      visionModel: typeof raw.visionModel === 'string' && raw.visionModel.trim() ? raw.visionModel.trim() : defaults.visionModel,
      aiEnabled: typeof raw.aiEnabled === 'boolean' ? raw.aiEnabled : true,
      visitorPasscode: typeof raw.visitorPasscode === 'string' ? raw.visitorPasscode : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    };
  } catch {
    return defaults;
  }
}

function saveAdminSettings(updates) {
  ensureLocalDataDir();
  const current = getAdminSettings();
  const next = {
    providerName: typeof updates.providerName === 'string' && updates.providerName.trim() ? updates.providerName.trim() : current.providerName,
    apiBaseUrl: typeof updates.apiBaseUrl === 'string' && updates.apiBaseUrl.trim() ? updates.apiBaseUrl.trim() : current.apiBaseUrl,
    apiKey: typeof updates.apiKey === 'string' ? updates.apiKey.trim() : current.apiKey,
    textModel: typeof updates.textModel === 'string' && updates.textModel.trim() ? updates.textModel.trim() : current.textModel,
    visionModel: typeof updates.visionModel === 'string' && updates.visionModel.trim() ? updates.visionModel.trim() : current.visionModel,
    aiEnabled: typeof updates.aiEnabled === 'boolean' ? updates.aiEnabled : current.aiEnabled,
    visitorPasscode: typeof updates.visitorPasscode === 'string' ? updates.visitorPasscode.trim() : current.visitorPasscode,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function getEnvApiKey() {
  return process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
}

function getEffectiveApiKey(settingsApiKey) {
  return (settingsApiKey || '').trim() || getEnvApiKey();
}

function maskApiKey(key) {
  const trimmed = (key || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 9) return '****';
  return `${trimmed.slice(0, 5)}****${trimmed.slice(-4)}`;
}

function resolveCompletionsUrl(baseUrl) {
  const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(cleanBase);
  } catch {
    throw new Error('API Base URL 格式无效，请填写以 https:// 开头的完整地址');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('API Base URL 仅支持 http:// 或 https:// 协议');
  }
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('不允许访问内部元数据地址');
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath.endsWith('/chat/completions')) {
    return cleanBase;
  }
  return `${cleanBase}/chat/completions`;
}

function readLogs() {
  try {
    if (!fs.existsSync(LOGS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLogs(logs) {
  ensureLocalDataDir();
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

function appendActivityLog(entry) {
  const logs = readLogs();
  const key = `logs/${String(9999999999999 - Date.now()).padStart(13, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  logs.unshift({ ...entry, key });
  writeLogs(logs.slice(0, 200));
}

function buildSettingsSummary(settings) {
  const effectiveKey = getEffectiveApiKey(settings.apiKey);
  return {
    ok: true,
    providerName: settings.providerName,
    apiBaseUrl: settings.apiBaseUrl,
    textModel: settings.textModel,
    visionModel: settings.visionModel,
    hasApiKey: Boolean(effectiveKey),
    hasStoredApiKey: Boolean(settings.apiKey),
    maskedApiKey: maskApiKey(effectiveKey),
    hasEnvFallbackKey: Boolean(getEnvApiKey()),
    aiEnabled: settings.aiEnabled,
    visitorPasscode: settings.visitorPasscode,
    updatedAt: settings.updatedAt
  };
}

function checkVisitorAccess(req, settings, effectiveApiKey) {
  if (!settings.aiEnabled) {
    return { ok: false, status: 403, error: '管理员当前已暂停公网 AI 引擎，请先使用内置高考真题离线示范模式。' };
  }
  if (!effectiveApiKey) {
    return { ok: false, status: 503, error: '管理员尚未配置云端大模型 API Key，请先体验内置离线示范模式或联系管理员配置。' };
  }
  if (settings.visitorPasscode) {
    const passed = (req.headers['x-visitor-passcode'] || '').toString().trim();
    if (!safeEqual(passed, settings.visitorPasscode) && !isAdminRequest(req)) {
      return { ok: false, status: 401, error: '需要输入正确的访客体验口令才能调用云端 AI。', code: 'PASSCODE_REQUIRED' };
    }
  }
  return { ok: true };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Visitor-Passcode',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体过大，请压缩图片后重试（上限 12MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('无效的 JSON 请求体'));
      }
    });
    req.on('error', reject);
  });
}

function extractJsonFromText(text) {
  if (!text) throw new Error('模型返回为空');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未能从模型输出中提取有效 JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function extractMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && 'text' in part ? String(part.text || '') : ''))
      .join('');
  }
  return '';
}

async function callChatCompletion({ apiBaseUrl = DEFAULT_BASE_URL, apiKey, model, messages, temperature = 0.3, maxTokens }) {
  const endpoint = resolveCompletionsUrl(apiBaseUrl);
  const body = { model, messages, temperature };
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    body.max_tokens = maxTokens;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || data?.message || '上游 API 错误';
    throw new Error(`${msg} (HTTP ${response.status})`);
  }
  return extractMessageContent(data.choices?.[0]?.message?.content);
}

async function handleAnalyze(req, res) {
  try {
    const settings = getAdminSettings();
    const apiKey = getEffectiveApiKey(settings.apiKey);
    const access = checkVisitorAccess(req, settings, apiKey);
    if (!access.ok) {
      return sendJson(res, access.status, { error: access.error, ...(access.code ? { code: access.code } : {}) });
    }

    const body = await readBody(req);
    const { mode = 'industrial', questionText = '' } = body;
    const trimmedText = String(questionText || '').trim();
    const rawImages = Array.isArray(body.imageDataUrls)
      ? body.imageDataUrls
      : body.imageDataUrl
      ? [body.imageDataUrl]
      : [];
    const validImages = rawImages
      .filter(img => typeof img === 'string' && img.startsWith('data:image/'))
      .slice(0, 4);
    const hasImage = validImages.length > 0;

    if (!trimmedText && !hasImage) {
      return sendJson(res, 400, { error: '请至少输入题目文本或上传题目截图。' });
    }

    const modeLabel = mode === 'organic' ? '高中化学有机推断与合成路线' : '高中化学化工工业流程';
    const systemPrompt = `你是一位拥有20年教龄的高中化学特级教师，擅长用“苏格拉底式思维脚手架”引导学生攻克【${modeLabel}】大题。
你的任务是将用户提供的题目拆解为 4~6 个循序渐进的流程节点，帮助学生一步步独立思考，**绝不能一上来就给出最终答案**。

请严格按照以下 JSON 格式输出（不要输出任何多余解释文字）：
{
  "title": "简短的题目名称（如：废旧锂电池回收制备Co3O4工艺流程）",
  "mode": "${mode}",
  "core_goal": "一句话概括本题的原料、目标产物及核心主线",
  "knowledge_tags": ["考点1", "考点2", "考点3"],
  "nodes": [
    {
      "id": 1,
      "step_name": "环节名称（如：酸浸与氧化）",
      "material_change": "物质转化主线（如：LiCoO2 + H2SO4 + H2O2 → Co2+ + Li+）",
      "scaffold_question": "第一层：启发式反问（引导学生自己思考这一步为什么要加该试剂/控制该条件）",
      "hint_level_1": "第二层：方向点拨（只给思考切入点，不直接给方程式或结论）",
      "hint_level_2": "第二层进阶：关键反应原理或试剂作用提示",
      "key_equation": "第三层：规范配平的化学/离子方程式及条件（用常见化学符号如 Fe²⁺、SO₄²⁻、↑、↓、⇌）",
      "trap_alert": "第三层：高考高频易错点/扣分陷阱"
    }
  ]
}

科学性硬性约束：
1. 所有化学式、离子电荷、原子守恒、得失电子守恒必须 100% 准确。
2. scaffold_question 必须具有启发性，不能直接剧透 key_equation 的答案。
输出中所有化学式请使用 Unicode 上下标字符（如 H₂SO₄、Fe³⁺、SO₄²⁻），不要使用 Markdown 或 LaTeX 语法。`;

    const model = hasImage
      ? (settings.visionModel || settings.textModel || 'deepseek-flash')
      : (settings.textModel || 'deepseek-chat');
    const userContent = hasImage
      ? [
          {
            type: 'text',
            text: trimmedText
              ? `请综合识别以下 ${validImages.length} 张图片中的化学题目（含题干、流程图/合成路线、数据表及设问等），并结合补充说明进行步进式流程拆解：\n${trimmedText}`
              : `请综合识别以下 ${validImages.length} 张图片中的化学题目（含题干、流程图/合成路线、数据表及设问等），并将其拆解为步进式思维脚手架 JSON。`
          },
          ...validImages.map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      : `请将以下化学题目拆解为步进式思维脚手架 JSON：\n\n${trimmedText}`;

    const rawOutput = await callChatCompletion({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.25
    });

    const parsed = extractJsonFromText(rawOutput);
    try {
      appendActivityLog({
        type: 'analyze',
        timestamp: new Date().toISOString(),
        mode: String(mode),
        topicTitle: String(parsed?.title || '未命名题目'),
        questionPreview: trimmedText
          ? trimmedText.slice(0, 220)
          : `[多模态识图：共 ${validImages.length} 张题目截图]`,
        hasImage,
        imageCount: validImages.length,
        modelUsed: model,
        region: '本地运行'
      });
    } catch {}

    return sendJson(res, 200, { ok: true, modelUsed: model, data: parsed });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || '题目拆解失败' });
  }
}

async function handleEvaluateThought(req, res) {
  try {
    const settings = getAdminSettings();
    const apiKey = getEffectiveApiKey(settings.apiKey);
    const access = checkVisitorAccess(req, settings, apiKey);
    if (!access.ok) {
      return sendJson(res, access.status, { error: access.error, ...(access.code ? { code: access.code } : {}) });
    }

    const body = await readBody(req);
    const { node, studentThought, topicTitle = '', mode = '' } = body;
    const thoughtText = String(studentThought || '').trim();
    if (!node || !thoughtText) {
      return sendJson(res, 400, { error: '请输入你的思考思路后再提交点评。' });
    }

    const systemPrompt = `你是高中化学特级教师，正在辅导学生做流程题的某一个环节。
请根据该环节的真实原理，对学生的想法进行简短、精准、鼓励性的点评（120字以内）：
1. 先肯定学生说对的部分；
2. 如果有遗漏或科学性偏差（如漏了氧化还原、未考虑水解、官能团位置判断有误），用启发式追问点出来；
3. 如果学生已经完全答到核心点，明确表扬并提示他可以点击“解锁标准解析”核对方程式。`;

    const userPrompt = `【当前环节】${node.step_name}（${node.material_change}）
【引导问题】${node.scaffold_question}
【参考核心原理】${node.hint_level_2}；方程式：${node.key_equation}
【学生的回答】${thoughtText}`;

    const model = settings.textModel || 'deepseek-chat';
    const feedback = await callChatCompletion({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4
    });

    try {
      appendActivityLog({
        type: 'thought',
        timestamp: new Date().toISOString(),
        mode: String(mode || ''),
        topicTitle: String(topicTitle || ''),
        stepName: String(node.step_name || ''),
        studentThought: thoughtText.slice(0, 300),
        aiFeedback: feedback.trim().slice(0, 220),
        modelUsed: model,
        region: '本地运行'
      });
    } catch {}

    return sendJson(res, 200, { ok: true, feedback: feedback.trim() });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || '思路点评失败' });
  }
}

async function handleVariant(req, res) {
  try {
    const settings = getAdminSettings();
    const apiKey = getEffectiveApiKey(settings.apiKey);
    const access = checkVisitorAccess(req, settings, apiKey);
    if (!access.ok) {
      return sendJson(res, access.status, { error: access.error, ...(access.code ? { code: access.code } : {}) });
    }

    const body = await readBody(req);
    const { topicTitle = '', weakNodes = [], mode = 'industrial' } = body;
    const weakList = Array.isArray(weakNodes) ? weakNodes : [];
    const weakDesc = weakList.length
      ? weakList.map(n => `${n.step_name}（${n.material_change}）`).join('；')
      : '流程综合分析与离子方程式书写';

    const systemPrompt = `你是高中化学命题专家。请针对学生刚才在【${topicTitle}】（${mode === 'organic' ? '有机推断' : '化工流程'}）中卡壳的薄弱环节：${weakDesc}，命制 1 道高质量的单选微变式题。
严格输出以下 JSON 格式：
{
  "question": "题干内容（含具体化学情境）",
  "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
  "answer": "B",
  "analysis": "详细解析（说明为什么选该项，以及其他选项的错误原因）",
  "target_skill": "本题巩固的核心考点"
}`;

    const model = settings.textModel || 'deepseek-chat';
    const rawOutput = await callChatCompletion({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请生成 1 道靶向变式巩固题。' }
      ],
      temperature: 0.4
    });

    const parsed = extractJsonFromText(rawOutput);
    try {
      appendActivityLog({
        type: 'variant',
        timestamp: new Date().toISOString(),
        mode: String(mode),
        topicTitle: String(topicTitle || ''),
        weakNodes: weakList.map(n => String(n?.step_name || '')).filter(Boolean),
        questionPreview: String(parsed?.question || '').slice(0, 200),
        modelUsed: model,
        region: '本地运行'
      });
    } catch {}

    return sendJson(res, 200, { ok: true, data: parsed });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || '变式题生成失败' });
  }
}

async function handleGradeHomework(req, res) {
  try {
    const settings = getAdminSettings();
    const apiKey = getEffectiveApiKey(settings.apiKey);
    const access = checkVisitorAccess(req, settings, apiKey);
    if (!access.ok) {
      return sendJson(res, access.status, { error: access.error, ...(access.code ? { code: access.code } : {}) });
    }

    const body = await readBody(req);
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0) {
      return sendJson(res, 400, { error: '无效的请求体，需要非空 messages 数组。' });
    }

    const messages = body.messages.slice(0, 12);
    const hasImage = messages.some(msg =>
      msg &&
      Array.isArray(msg.content) &&
      msg.content.some(part => part && typeof part === 'object' && part.type === 'image_url' && Boolean(part.image_url?.url))
    );
    const model = hasImage
      ? (settings.visionModel || settings.textModel || 'deepseek-flash')
      : (settings.textModel || 'deepseek-chat');
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.2;
    const maxTokens =
      typeof body.maxTokens === 'number' && body.maxTokens > 0
        ? Math.min(8192, Math.max(16, Math.round(body.maxTokens)))
        : 4096;

    const content = await callChatCompletion({
      apiBaseUrl: settings.apiBaseUrl,
      apiKey,
      model,
      messages,
      temperature,
      maxTokens
    });

    return sendJson(res, 200, { ok: true, content, model });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || '云端 AI 批改失败' });
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = parsedUrl.pathname;

  if (req.method === 'OPTIONS' && urlPath.startsWith('/api/')) {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.method === 'GET' && urlPath === '/api/health') {
    const settings = getAdminSettings();
    const effectiveKey = getEffectiveApiKey(settings.apiKey);
    return sendJson(res, 200, {
      ok: true,
      aiEnabled: settings.aiEnabled,
      aiReady: Boolean(settings.aiEnabled && effectiveKey),
      requiresPasscode: Boolean(settings.visitorPasscode),
      providerName: settings.providerName,
      textModel: settings.textModel,
      visionModel: settings.visionModel
    });
  }

  if (req.method === 'POST' && urlPath === '/api/analyze') return handleAnalyze(req, res);
  if (req.method === 'POST' && urlPath === '/api/evaluate-thought') return handleEvaluateThought(req, res);
  if (req.method === 'POST' && urlPath === '/api/variant') return handleVariant(req, res);
  if (req.method === 'POST' && urlPath === '/api/grade-homework') return handleGradeHomework(req, res);

  if (req.method === 'POST' && urlPath === '/api/admin/login') {
    const body = await readBody(req).catch(() => ({}));
    if (!safeEqual(body?.password || '', getAdminPassword())) {
      return sendJson(res, 401, { error: '管理员密码错误' });
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': createAdminCookie() });
  }

  if (req.method === 'POST' && urlPath === '/api/admin/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearAdminCookie() });
  }

  if (urlPath === '/api/admin/settings') {
    if (!isAdminRequest(req)) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (req.method === 'GET') {
      return sendJson(res, 200, buildSettingsSummary(getAdminSettings()));
    }
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: '无效的 JSON 请求体' });
      const updates = {};
      if (typeof body.providerName === 'string' && body.providerName.trim()) updates.providerName = body.providerName.trim();
      if (typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim()) {
        try {
          resolveCompletionsUrl(body.apiBaseUrl);
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'API Base URL 格式无效' });
        }
        updates.apiBaseUrl = body.apiBaseUrl.trim().replace(/\/+$/, '');
      }
      if (typeof body.textModel === 'string' && body.textModel.trim()) updates.textModel = body.textModel.trim();
      if (typeof body.visionModel === 'string' && body.visionModel.trim()) updates.visionModel = body.visionModel.trim();
      if (body.clearApiKey === true) updates.apiKey = '';
      else if (typeof body.apiKey === 'string' && body.apiKey.trim()) updates.apiKey = body.apiKey.trim();
      else if (typeof body.deepseekApiKey === 'string' && body.deepseekApiKey.trim()) updates.apiKey = body.deepseekApiKey.trim();
      if (typeof body.aiEnabled === 'boolean') updates.aiEnabled = body.aiEnabled;
      if (typeof body.visitorPasscode === 'string') updates.visitorPasscode = body.visitorPasscode.trim();
      return sendJson(res, 200, buildSettingsSummary(saveAdminSettings(updates)));
    }
  }

  if (req.method === 'POST' && urlPath === '/api/admin/test-ai') {
    if (!isAdminRequest(req)) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const body = await readBody(req).catch(() => ({})) || {};
    const settings = getAdminSettings();
    const apiBaseUrl = typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim() ? body.apiBaseUrl.trim() : settings.apiBaseUrl;
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : getEffectiveApiKey(settings.apiKey);
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : settings.textModel || 'deepseek-chat';
    if (!apiKey) return sendJson(res, 400, { error: '请先填写或保存 API Key 再测试连通性。' });
    let endpoint = '';
    try {
      endpoint = resolveCompletionsUrl(apiBaseUrl);
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'API Base URL 无效' });
    }
    const startedAt = Date.now();
    try {
      const reply = await callChatCompletion({
        apiBaseUrl,
        apiKey,
        model,
        messages: [{ role: 'user', content: '请只回复 OK' }],
        temperature: 0,
        maxTokens: 16
      });
      return sendJson(res, 200, { ok: true, latencyMs: Date.now() - startedAt, model, endpoint, reply: reply.trim().slice(0, 60) });
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: err.message || '上游 API 测试失败' });
    }
  }

  if (urlPath === '/api/admin/logs') {
    if (!isAdminRequest(req)) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (req.method === 'GET') {
      const logs = readLogs().slice(0, 100);
      let analyzeCount = 0, thoughtCount = 0, variantCount = 0;
      const weakFreq = new Map();
      for (const log of logs) {
        if (log.type === 'analyze') analyzeCount += 1;
        else if (log.type === 'thought') thoughtCount += 1;
        else if (log.type === 'variant') {
          variantCount += 1;
          for (const step of log.weakNodes || []) {
            if (step) weakFreq.set(step, (weakFreq.get(step) || 0) + 1);
          }
        }
      }
      const topWeakSteps = Array.from(weakFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([step, count]) => ({ step, count }));
      return sendJson(res, 200, {
        ok: true,
        stats: { total: logs.length, analyzeCount, thoughtCount, variantCount, topWeakSteps },
        logs
      });
    }
    if (req.method === 'DELETE') {
      const all = parsedUrl.searchParams.get('all');
      const key = parsedUrl.searchParams.get('key');
      if (all === 'true') {
        writeLogs([]);
        return sendJson(res, 200, { ok: true });
      }
      if (key) {
        writeLogs(readLogs().filter(l => l.key !== key));
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 400, { error: '请指定要删除的记录 key 或 all=true' });
    }
  }

  // 静态文件服务
  const target = urlPath === '/' ? 'index.html' : urlPath === '/admin' ? 'admin.html' : urlPath;
  let filePath = path.join(PUBLIC_DIR, target);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`循迹·化析 服务器已启动: http://localhost:${PORT}`);
});
