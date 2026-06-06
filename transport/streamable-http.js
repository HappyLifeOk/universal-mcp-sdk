'use strict';

/**
 * transport/streamable-http.js
 * Streamable HTTP 传输层
 *
 * MCP 规范定义的 HTTP 传输协议：
 *   - POST /mcp  — 发送 JSON-RPC 请求，接收 JSON-RPC 响应
 *   - GET /mcp  — 初始化握手（发送 initialize 请求）
 *   - GET /  — 健康检查 / 服务器信息
 *
 * 参考：https://modelcontextprotocol.io/specification/basic/transports
 */

const http = require('http');
const url = require('url');

function createHttpTransport(dispatcher, options) {
    options = options || {};
    const port = options.port || 8080;
    const host = options.host || '127.0.0.1';
    const path = options.path || '/mcp';

    let server = null;

    // ── 发送 JSON-RPC 响应的辅助函数 ─────────────────────────────
    function sendJson(res, statusCode, body) {
        const data = JSON.stringify(body);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
        });
        res.end(data);
    }

    function sendError(res, statusCode, code, message) {
        sendJson(res, statusCode, {
            jsonrpc: '2.0',
            error: { code, message },
            id: null,
        });
    }

    // ── 处理 POST /mcp ───────────────────────────────────────────
    async function handleMcpPost(req, res) {
        // CORS（允许跨域，方便不同客户端调用）
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method !== 'POST') {
            sendError(res, 405, -32600, 'Method not allowed, use POST');
            return;
        }

        // 读取 body
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            let reqJson;
            try {
                reqJson = JSON.parse(body);
            } catch (e) {
                sendError(res, 400, -32700, 'Parse error');
                return;
            }

            try {
                const resJson = await dispatcher.dispatchAsync(reqJson);
                if (resJson) {
                    sendJson(res, 200, resJson);
                } else {
                    // notification，无响应
                    res.writeHead(204);
                    res.end();
                }
            } catch (err) {
                sendJson(res, 200, {
                    jsonrpc: '2.0',
                    id: reqJson.id || null,
                    error: { code: -32603, message: `Internal error: ${err.message}` },
                });
            }
        });
    }

    // ── 处理 GET /mcp（初始化握手）────────────────────────────────
    function handleMcpGet(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // 返回服务器信息和可用端点说明
        sendJson(res, 200, {
            name: 'mcp-sdk-http-transport',
            version: '1.0.0',
            endpoints: {
                'POST /mcp': 'Send JSON-RPC 2.0 request, receive JSON-RPC 2.0 response',
                'GET /mcp': 'Server info and endpoint documentation',
                'GET /': 'Health check',
            },
        });
    }

    // ── 启动 HTTP 服务器 ─────────────────────────────────────────
    function start() {
        server = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);

            // 路由分发
            if (parsedUrl.pathname === path && req.method === 'POST') {
                handleMcpPost(req, res);
            } else if (parsedUrl.pathname === path && req.method === 'GET') {
                handleMcpGet(req, res);
            } else if (parsedUrl.pathname === '/' && req.method === 'GET') {
                sendJson(res, 200, { status: 'ok', timestamp: Date.now() });
            } else {
                sendError(res, 404, -32600, `Not found: ${req.url}`);
            }
        });

        server.listen(port, host, () => {
            console.log(`[mcp-sdk] HTTP transport listening on http://${host}:${port}${path}`);
        });

        server.on('error', (err) => {
            console.error(`[mcp-sdk] HTTP server error: ${err.message}`);
        });

        return server;
    }

    function stop() {
        if (server) {
            server.close();
            server = null;
        }
    }

    return { start, stop, port, host, path };
}

module.exports = { createHttpTransport };