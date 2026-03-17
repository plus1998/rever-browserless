_____                      ____                                      
 |  __ \                    |  _ \                                     
 | |__) |_____   _____ _ __| |_) |_ __ _____      _____  ___ _ __ ___ 
 |  _  // _ \ \ / / _ \ '__|  _ <| '__/ _ \ \ /\ / / __|/ _ \ '__/ __|
 | | \ \  __/\ V /  __/ |  | |_) | | | (_) \ V  V /\__ \  __/ |  \__ \
 |_|  \_\___| \_/ \___|_|  |____/|_|  \___/ \_/\_/ |___/\___|_|  |___/
                                                                        
>> Reverse Browserless Tunneling System | Powered by Bun.js <<

这是一个基于 `Bun + Puppeteer + Browserless` 的反向连接方案。

核心特点：

- `browserless` 可以部署在本地机器、局域网服务器或内网集群中
- 浏览器节点主动向中心 `server` 发起反向连接，不需要为每个节点暴露公网入口
- 用户侧只需要连接中心 `server`，不需要直接访问具体的 `browserless` 实例
- 中心 `server` 会校验 `token`，防止未授权的节点注册和 Puppeteer 盗连
- 适合把多个本地 `browserless` 节点组织成一个可调度的浏览器集群

相比直接暴露远程 Chromium WebSocket，这种方式的优势是：

- 浏览器执行环境可以留在本地或内网，安全边界更清晰
- 不依赖公网暴露端口，也不要求给每台浏览器机器配置外网地址
- 更容易横向扩容，本地新增节点后只要连接中心 `server` 即可加入集群

运行顺序如下：

1. 部署 `browserless`
2. 启动 `server`
3. 运行 `test`

## 前置条件

- 已安装 `Bun`
- 已安装 `Docker` 和 `Docker Compose`

安装根目录依赖：

```bash
bun install
```

## 架构说明

整体链路如下：

```text
Puppeteer/Test -> server -> 反向连接槽位 -> 本地 browserless
```

其中：

- `server.ts` 是中心调度器，负责维护空闲槽位和分配会话
- `browserless/connect.ts` 是反向连接客户端，启动后会主动连到 `server`
- 本地 `browserless` 容器只在内网提供能力，不需要直接对外开放

这意味着你可以把 `browserless` 部署在本机、旁路机、局域网机器，甚至多台机器组成的本地集群中，只要这些节点能访问中心 `server`，就能对外统一提供浏览器能力。

## 1. 部署 browserless

进入 `browserless` 目录：

```bash
cd browserless
```

复制环境变量文件：

```bash
cp .env.example .env
```

修改 `.env` 中的关键配置：

```env
TOKEN=secret-token-changeme
SERVER_URL=ws://<你的服务器IP>:8080/register
CONCURRENT=10
TIMEOUT=0
```

说明：

- `SERVER_URL` 需要指向运行 `server.ts` 的机器地址
- `TOKEN` 需要和本地 Browserless 容器保持一致
- `CONCURRENT` 表示预创建的可用槽位数量
- 这里的 `browserless` 可以部署在本机或内网环境，不要求公网可访问
- 如果有多台本地机器，可以分别部署多个 `browserless + frp-client` 实例，共同组成集群

启动容器：

```bash
docker compose up -d --build
```

如需查看状态：

```bash
docker compose ps
docker compose logs -f
```

## 2. 启动 server

回到项目根目录后启动调度服务：

```bash
cd ..
TOKEN=secret-token-changeme bun run server.ts
```

默认监听端口为 `8080`，提供两个 WebSocket 入口：

- `ws://<server-ip>:8080/register?token=<TOKEN>`
- `ws://<server-ip>:8080/puppeteer?token=<TOKEN>`

其中：

- `/register` 供本地 `browserless` 节点反向注册槽位
- `/puppeteer` 供用户侧 `Puppeteer` 或 `test.ts` 连接使用
- 两个入口都会校验 `token`，未授权请求会被 `401` 拒绝

## 3. 运行 test

在项目根目录新开一个终端，执行：

```bash
TOKEN=secret-token-changeme bun run test.ts
```

`test.ts` 当前会连接：

```text
ws://localhost:8080/puppeteer?token=<TOKEN>
```

因此默认要求：

- `test.ts` 和 `server.ts` 运行在同一台机器上
- 如果 `server` 不在本机，可以通过 `BROWSER_WS_ENDPOINT` 指定对应地址
- `test.ts` 启动时必须提供 `TOKEN`，否则不会发起连接

## 常见流程

```bash
# 项目根目录
bun install

# 终端 1：部署 browserless
cd browserless
cp .env.example .env
docker compose up -d --build

# 终端 2：启动 server
cd /path/to/buyin-web-agent
TOKEN=secret-token-changeme bun run server.ts

# 终端 3：运行测试
cd /path/to/buyin-web-agent
TOKEN=secret-token-changeme bun run test.ts
```
