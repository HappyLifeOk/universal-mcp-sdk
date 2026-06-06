# universal-mcp-sdk

跨 Agent 的 MCP Server 开发套件。一次实现，同时支持：

- **Claude Code** / **Cursor** — stdio 传输
- **Mavis** — streamable-http 传输
- **任何 HTTP-based AI Agent** — streamable-http 传输

---

## 安装

```bash
npm install universal-mcp-sdk
# 或直接复制本目录到你的项目
```

---

## 快速开始

```js
const { createServer, tool, textContent } = require('universal-mcp-sdk');

const server = createServer({
    name: 'my-first-mcp',
    version: '1.0.0',
    tools: [
        tool('hello', '打招呼', { name: { type: 'string' } },
            async ({ name }) => textContent(`Hello, ${name}!`)),
        tool('add', '两数相加', { a: { type: 'number' }, b: { type: 'number' } },
            async ({ a, b }) => textContent(String(a + b))),
    ],
    resources: [
        {
            uri: 'hello://greeting',
            name: 'Default Greeting',
            description: '默认问候语',
            mimeType: 'text/plain',
            read: async () => 'Hello World',
        },
    ],
});

server.start();
```

直接 `node your-server.js` 启动时，SDK 会自动检测运行环境：
- **TTY 终端**（交互式启动）→ stdio 模式
- **非 TTY / 后台服务**（默认）→ HTTP 模式，监听 `http://127.0.0.1:8080/mcp`

需要强制指定模式时：

```bash
node your-server.js --stdio          # 强制 stdio（Claude Code / Cursor 子进程）
node your-server.js --http           # 强制 HTTP
node your-server.js --http --port 9000  # HTTP + 指定端口
```

---

## 完整示例

```js
const {
    createServer,
    tool,
    command,
    staticResource,
    dynamicResource,
    textContent,
    errorContent,
    imageContentFromFile,
} = require('universal-mcp-sdk');

const server = createServer({
    name: 'my-mcp-server',
    version: '2.0.0',
    tools: [
        tool('scene_query_node', '查询场景节点',
            { uuid: { type: 'string' } },
            async ({ uuid }) => {
                const data = await queryNode(uuid);
                return textContent(JSON.stringify(data, null, 2));
            }
        ),
        tool('preview_screenshot', '截图预览页面',
            { path: { type: 'string' } },
            async ({ path }) => {
                const absPath = await captureScreenshot(path);
                return textContent(absPath);
            }
        ),
        command('preview_refresh', '刷新预览', async () => {
            await doRefresh();
            return textContent('ok');
        }),
    ],
    resources: [
        staticResource('project://info', 'Project Info',
            JSON.stringify({ name: 'MyGame', version: '1.0.0' })
        ),
        dynamicResource('scene://tree', 'Current Scene Tree', '当前场景节点树',
            async () => await querySceneTree()
        ),
    ],
});

server.start();
```

---

## 启动模式

| 模式 | 命令 | 适用场景 |
|------|------|---------|
| stdio | `node your-server.js --stdio` | Claude Code / Cursor（子进程） |
| http | `node your-server.js --http --port 8080` | Mavis / HTTP Agent（常驻服务），--port 真正生效 |
| auto | `node your-server.js` | 自动检测：TTY → stdio，否则 → HTTP |

---

## 注册到不同 Agent

### Claude Code / Cursor

在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "my-mcp": {
      "command": "node",
      "args": ["/path/to/your-server.js", "--stdio"]
    }
  }
}
```

### Mavis

在 `~/.mavis/mcp/mcp.json`（或项目 `.mavis/mcp/mcp.json`）添加：

```json
{
  "mcpServers": {
    "my-mcp": {
      "url": "http://127.0.0.1:8080/mcp",
      "type": "streamable-http",
      "env": {},
      "enabled": true,
      "description": "我的 MCP 服务"
    }
  }
}
```

### 其他 HTTP Agent

直接 POST 请求到 `http://127.0.0.1:8080/mcp`：

```bash
# 初始化
curl -X GET http://127.0.0.1:8080/mcp

# 调用 tool
curl -X POST http://127.0.0.1:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{"name":"world"}}}'
```

---

## API 参考

### createServer(options)

| 选项 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 服务器名称 |
| `version` | string | 是 | 服务器版本 |
| `tools` | Array | 否 | tool 定义列表 |
| `resources` | Array | 否 | resource 定义列表 |
| `customHandlers` | object | 否 | 自定义 JSON-RPC 方法 |
| `port` | number | 否 | HTTP 模式端口，默认 8080 |
| `entryPoint` | string | 否 | 用于生成配置文件的入口路径 |

### tool(name, description, inputSchema, handler)

- `name`: 工具唯一标识，snake_case
- `description`: AI 靠这个理解工具用途
- `inputSchema`: JSON Schema（定义参数结构）
- `handler`: `async (args) => result`

handler 返回值会自动包装为 MCP content block：

| 返回类型 | 包装方式 |
|---------|---------|
| `string` | `textContent(text)` |
| `object` | `textContent(JSON.stringify(result))` |
| `Array` (content block) | 直接使用 |
| `undefined` / `null` | `textContent('(ok)')` |

### command(name, description, handler)

无参数工具的简写，内部调用 `tool()` 并传入空 `inputSchema`。

### staticResource(uri, name, text, mimeType)

静态文本 resource，每次 read 返回相同内容。

### dynamicResource(uri, name, description, readFn, mimeType)

动态 resource，每次 read 调用 `readFn()` 获取最新内容。

---

## 动态注册

```js
server.addTool({
    name: 'dynamic_tool',
    description: '运行时动态添加的工具',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => textContent('dynamic!'),
});

server.addResource({
    uri: 'dynamic://resource',
    name: 'Dynamic Resource',
    description: '运行时添加',
    mimeType: 'text/plain',
    read: async () => 'fresh data',
});
```

---

## 配置生成

```js
server.printConfig();
```

输出 Claude Code 配置和 Mavis 配置，可直接复制使用。

---

## 文件结构

```
mcp-sdk/
├── index.js                    # 入口，createServer()
├── tool.js                     # tool 定义辅助
├── resource.js                 # resource 定义辅助
├── test-server.js              # 可运行的测试示例服务器
├── protocol/
│   ├── dispatcher.js           # JSON-RPC 2.0 核心分发
│   └── content.js              # content block 封装
├── transport/
│   ├── stdio.js                # Claude Code / Cursor 传输
│   └── streamable-http.js      # Mavis / HTTP Agent 传输
└── README.md
```

---

## License

Apache-2.0 — Copyright 2026 付饶. See [LICENSE](./LICENSE) for details.