# DSH WorkBuddy Connect


[English](./README.en.md) | 中文


将 WorkBuddy 桌面 App 中包含的各种模型（GLM-5.3、GLM-5.2、DeepSeek-V4-Pro、DeepSeek-V4-Flash、Kimi-K3、MiniMax-M3 、Hy3等）自动接入 DeepSeek Harness，实现在 DSH 对话窗口里零配置使用。


## 功能

- **开箱即用**：安装和启用插件后，在 DSH 中直接使用，无需额外配置。


![WorkBuddy 模型出现在 DSH 模型选择器中](assets/1.png)


- **图片输入**：按上游逐模型声明的能力放行图片——绝大多数模型（含 GLM-5.3-Flash、GLM-5.2、DeepSeek-V4 系列等）可直接粘贴或拖入图片；个别纯文本模型（如 GLM-5.1）按上游声明仍会明确提示不支持。


- **信息查看**：设置 → 插件 → DSH WorkBuddy Connect 卡片


![设置卡片显示插件](assets/2.png)

卡片展开后，可查看账号信息、令牌有效期与剩余积分。

![设置卡片显示账号与剩余积分](assets/3.png)

## 安装

前置：已安装并登录 WorkBuddy 桌面 App（插件复用 App 的登录状态，账号切换自动跟随）。

插件在三种 DSH 界面下均可运行：**Web**、**Desktop**、**TUI**。根据你使用的 profile 选对应命令安装。

```sh
# Web（推荐，自带预构建产物）
dsh plugin --profile web add dsh-workbuddy-connect
dsh web

# 或从 GitHub 源码安装 Web 版
dsh plugin --profile web add github:corrinehu/dsh-workbuddy-connect
dsh web
```

```sh
# Desktop（DSH Desktop 桌面版）
dsh plugin --profile desktop add dsh-workbuddy-connect
dsh --profile desktop
```

```sh
# TUI（终端界面）
dsh plugin --profile dsh-tui add dsh-workbuddy-connect
dsh --profile dsh-tui
```

> 提示：`dsh-tui` profile 需用 pnpm 11 安装（PATH 里是其他版本会报 `ERR_PNPM_UNEXPECTED_STORE`，用 `npx pnpm@11` 即可）；已验证 dsh `0.1.1-rc.2`。

安装后，在对应界面的模型选择器里切换到 WorkBuddy 模型即可使用；Web 下设置卡片（设置 → 插件 → DSH WorkBuddy Connect）可查看账号信息、令牌有效期与剩余积分，TUI 下可在 `/settings` 里配置 `authFile`。

## 命令行

`dsh plugin --profile <web|desktop|dsh-tui> exec dsh-workbuddy-connect status`：登录状态与剩余积分（`--json` 输出机器可读格式；另有 `doctor` 诊断、`logout` 清理凭据）。

## 通用 OpenAI BaseURL（已安装 DSH 插件的用户）

已安装本插件且已登录 WorkBuddy 桌面 App 的 Windows 用户，可启动仅限本机的 OpenAI Chat Completions 兼容端点：

```powershell
$env:WORKBUDDY_PROXY_API_KEY = "sk-local-workbuddy"
dsh-workbuddy-connect serve
```

默认会显示：

```text
WorkBuddy OpenAI proxy is running
Base URL: http://127.0.0.1:7863/v1
API Key: configured via WORKBUDDY_PROXY_API_KEY
Bind: 127.0.0.1 only
Press Ctrl+C to stop.
```

在支持 OpenAI Chat Completions 的客户端中填写：

```text
Base URL: http://127.0.0.1:7863/v1
API Key:  sk-local-workbuddy
```

支持的接口与能力：

| 接口或能力 | 说明 |
| --- | --- |
| `GET /v1/models` | 当前 WorkBuddy 模型目录 |
| `POST /v1/chat/completions` | OpenAI Chat Completions 兼容请求 |
| `GET /healthz` | 本机健康检查 |
| `stream: true` | 原样 SSE 流式返回 |
| `stream: false` 或省略 | 在本机聚合上游 SSE，返回一个 `chat.completion` JSON |
| tools / `tool_choice` | 透传并沿用已有上游规范化 |
| `reasoning_content`、工具参数片段 | 非流式响应中聚合 |
| 图片消息 | 沿用已有按模型声明的多模态透传 |

安全与边界：

- 必须先登录 WorkBuddy 桌面 App；桌面端认证文件始终只读，刷新 token 仍仅写入插件自己的凭据副本。
- 服务只绑定 `127.0.0.1`，没有 `--host`、LAN 或远程访问。
- 推荐设置 `WORKBUDDY_PROXY_API_KEY` 以使用稳定本地密钥。`--api-key` 仅为便利功能，可能暴露在 shell 历史或进程检查中。
- 未设置密钥时会生成每次启动不同的临时密钥，并只显示一次。
- 不要把 WorkBuddy `accessToken` 或 `refreshToken` 粘贴到客户端；客户端只使用本地代理密钥。

本版本不支持 `/v1/responses`、`/v1/messages`、embeddings、远程/LAN 服务、独立 WorkBuddy OAuth 登录或多账号轮换。

## 已知限制

- 在 macOS 的 DSH Web / Desktop / TUI profile（`0.1.1-rc.2`+、Node 22+）下验证通过。Windows 会依次探测 Local 与 Roaming AppData；WSL 会优先从挂载的 Windows 用户目录读取登录凭据。若 Windows 与 Linux 用户名不同且 Windows 环境变量未传入 WSL，请通过 `WORKBUDDY_AUTH_FILE` 指定实际位置。
- 依赖 WorkBuddy 客户端接口（非官方开放 API），WorkBuddy 更新后插件可能需要随之调整。

## 免责声明

- 本项目**仅供个人学习和研究使用**，仅驱动使用者自己的 WorkBuddy 账号在本机调用，请勿用于商业用途或超出个人合理使用的场景。
- 使用者需遵守 WorkBuddy 的服务条款；因使用本项目产生的任何后果（包括但不限于账号被限制、额度被清空、服务中断），由使用者自行承担。
- 本项目作者不对任何因使用或滥用本项目产生的直接或间接损失负责。
- 本项目与腾讯、WorkBuddy、DeepSeek 均无关联，未获其授权或认可；文中出现的名称仅用于描述兼容关系，其商标权利归各自所有。

## 致谢

- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api)（MIT）— WorkBuddy 上游协议的参照实现。
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)（Apache-2.0）— DSH 插件结构与 provider 注册的参照。

## 许可证

[MIT](./LICENSE)
