# GMAT Agent

GMAT Agent 是一个由 React 前端和 Fastify 后端组成的航天工程工作台，核心用途是自动化 GMAT 轨道模拟及下游分析（Simu-CIC、OPALIS、RF-COMLINK）。项目通过根目录下的 `config.json` 读取模型、服务端口、工作区、GMAT 路径等配置。

> 项目原名为 "Open Codex Web"，早期版本侧重 Codex Agent 对话与远程 GUI 工具。当前版本已聚焦于 GMAT 任务研究流水线。

项目交接请先阅读英文版 [交接指南](docs/HANDOVER.md)。其中记录了外部依赖、证据保留规则以及当前 RF-COMLINK 结果提取的限制。

项目模块边界、数据保留规则见 [docs/CODE_STRUCTURE.md](docs/CODE_STRUCTURE.md)。

## 配置文件

项目不会自动创建真实配置。第一次启动前，请复制示例配置：

```bash
cp config.example.json config.json
```

然后编辑 `config.json`。`config.example.json` 中标记为 `REPLACE_WITH_...` 或 `/path/to/...` 的字段必须按本机环境填写；相邻的 `_...Comment` 字段只是填写说明。不要把真实 API Key、内网地址或模型路径提交到代码仓库。

### 关键字段

| 字段 | 说明 |
| --- | --- |
| `server.port` | 后端端口，必填 |
| `frontend.port` / `frontend.httpsPort` | 前端 HTTP / HTTPS 端口，必填 |
| `tmux.backendSession` / `tmux.frontendSession` | tmux 会话名，必填 |
| `workspace.templateDir` | 示例数据根目录 |
| `workspace.usersRoot` | 用户工作区根目录 |
| `tools.gmat.bin` | GMAT 控制台可执行文件路径（Windows 下用 `/mnt/c/.../GmatConsole.exe`） |
| `tools.gmat.timeoutMs` | GMAT 执行超时（毫秒） |
| `chatModel.apiKey` / `chatModel.baseUrl` / `chatModel.model` | LLM 配置，用于 Mission Studio 对话 |

## 启动项目（推荐）

**必须从 WSL 启动**，因为项目依赖 tmux 和 Linux 工具链：

```bash
cd /mnt/d/STAGE/agent-gmat-main
python3 scripts/start_local_web.py
```

脚本会：
1. 停止旧的 tmux 会话并释放端口
2. 自动安装前后端 npm 依赖
3. 校验 `config.json` 配置
4. 启动后端和前端（tmux 会话）
5. 等待服务就绪并打印访问 URL

### 选项

```bash
python3 scripts/start_local_web.py --require-model-health  # LLM 必须可达
python3 scripts/start_local_web.py --with-remote-gui       # 同时启动 FreeCAD/ParaView/COMSOL
python3 scripts/start_local_web.py --timeout 120           # 延长等待时间到 120s
```

### 手动启动

如果需要分别调试：

```bash
# 后端
cd backend && npm run dev

# 前端（另一个终端）
cd frontend && npm run dev:https
```

### 访问

启动成功后：
- 前端：`https://127.0.0.1:<frontend.httpsPort>`
- 后端健康检查：`http://127.0.0.1:<server.port>/api/health`

## 运行 GMAT 测试

```bash
cd backend

# 基础回归（GMAT baseline + digital thread）
npm run test:gmat:baseline

# Hohmann chimique
node --import tsx --test tests/gmat/chemicalHohmannGeneration.test.ts

# Electric transfer
npm run test:gmat:electric

# 全量
npm test
```

## 构建检查

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

## 项目结构

```text
backend/            Fastify API + 服务层
  src/gmat/         GMAT 模板、drafts、渲染、运行生命周期
  src/digitalThread/ 卫星定义、sélection de mission
  src/opalis/       Simu-CIC + OPALIS 流水线
  src/rfComlink/    RF-COMLINK 分析
  src/runs/         运行目录、artifact 管理、workflow
  src/modelBackends/ 模型路由适配器
  src/server/       服务器组合、请求上下文
  workflow_agents/  GMAT 模板资源（脚本、template.json、references）
frontend/           React + TypeScript + Vite
  src/pages/agent/  Mission Studio、Results、Discussion
data/               卫星库、输入数据、mission-runs
tools/              OPALIS / RF-COMLINK 外部脚本
```
