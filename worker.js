/**
 * 寫作三刀流 — Cloudflare Worker
 * 作用：代理 Anthropic API，保護 API Key
 * 部署後，前端把請求打到這個 Worker，不直接接觸 Anthropic
 *
 * 環境變數（在 Cloudflare Dashboard 設定）：
 *   ANTHROPIC_API_KEY — 你的 Anthropic API Key
 *   ALLOWED_ORIGIN    — 允許的前端網址（例：https://yourname.github.io）
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-sonnet-4-20250514';

export default {
  async fetch(request, env) {

    // ── CORS 預檢 ──
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    // ── 只接受 POST /api/chat ──
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      return new Response('Not Found', { status: 404 });
    }

    // ── 解析前端傳來的 body ──
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('無效的請求格式', 400, allowedOrigin);
    }

    const { systemPrompt, userMessage } = body;
    if (!systemPrompt || !userMessage) {
      return jsonError('缺少必要欄位：systemPrompt 或 userMessage', 400, allowedOrigin);
    }

    // ── 呼叫 Anthropic API（串流）──
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 2000,
        stream:     true,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    // ── 錯誤處理 ──
    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(errText, {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
      });
    }

    // ── 串流回傳給前端 ──
    return new Response(anthropicRes.body, {
      status: 200,
      headers: {
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
        ...corsHeaders(allowedOrigin),
      },
    });
  },
};

// ── 工具函式 ──
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
