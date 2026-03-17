/**
 * Browserless 反向代理客户端
 * * 核心逻辑：
 * 1. 启动时根据 CONCURRENT 创建固定数量的 WebSocket 隧道。
 * 2. 隧道平时保持空闲，仅占用极少量 Bun 运行时内存。
 * 3. 当指令到达时，按需连接本地 Browserless，任务结束立即切断。
 */

// --- 1. 配置加载 ---
const { 
  SERVER_URL, 
  TOKEN, 
  TIMEOUT = "0",
  CONCURRENT: ENV_CONCURRENT,
  QUEUED: ENV_QUEUED 
} = process.env;

// 严格校验必要参数
if (!SERVER_URL || !TOKEN) {
    throw new Error("❌ 环境缺失: 必须设置 SERVER_URL 和 TOKEN");
}

const browserlessServerUrl = SERVER_URL;
const browserlessToken = TOKEN;

// 设定默认值：如果不传，则 CONCURRENT=5, QUEUED=10
const CONCURRENT = Number(ENV_CONCURRENT) || 5;
const QUEUED     = Number(ENV_QUEUED)     || 10;

// 构造本地连接地址，透传所有核心参数给 Browserless
const LOCAL_URL = `ws://localhost:3000?token=${browserlessToken}&timeout=${TIMEOUT}`;

console.log(`
--------------------------------------------------
✅ Client 配置确认:
- 中心服务器: ${browserlessServerUrl}
- 鉴权令牌: ${browserlessToken}
- 并发/队列: ${CONCURRENT} / ${QUEUED}
- 超时设置: ${TIMEOUT}ms
--------------------------------------------------
`);

// --- 2. 启动并发槽位 ---
for (let i = 0; i < CONCURRENT; i++) {
    startSlot(i);
}

/**
 * 启动并维护一个独立的工作槽位
 */
function startSlot(slotId: number) {
    const registerUrl = new URL(browserlessServerUrl);
    registerUrl.searchParams.set("slot", String(slotId));
    registerUrl.searchParams.set("token", browserlessToken);

    // 建立到中心服务器的长连接
    const serverWs = new WebSocket(registerUrl.toString());
    
    // 该槽位对应的本地浏览器 WebSocket 实例
    let localWs: WebSocket | null = null;

    // A. 接收到中心服务器（即 Puppeteer 端）发送的指令
    serverWs.onmessage = (event) => {
        const payload = event.data;

        // 如果本地连接还没建立，则执行“懒连接”
        if (!localWs || localWs.readyState !== WebSocket.OPEN) {
            console.log(`[槽位 ${slotId}] 📥 任务进入，正在激活本地浏览器会话...`);
            
            localWs = new WebSocket(LOCAL_URL);

            // 监听浏览器反馈并直接回传给中心服务器
            localWs.onmessage = (bEvent) => {
                if (serverWs.readyState === WebSocket.OPEN) {
                    serverWs.send(bEvent.data);
                }
            };

            // 浏览器连接建立后，转发当前接收到的第一条指令
            localWs.onopen = () => localWs?.send(payload);

            // 异常或正常断开时，同步销毁物理连接
            localWs.onclose = () => serverWs.close();
            localWs.onerror = () => serverWs.close();
        } else {
            // 已有连接，直接透传指令流
            localWs.send(payload);
        }
    };

    // B. 当中心服务器连接断开时（意味着 Puppeteer 端会话结束或异常）
    serverWs.onclose = () => {
        // 【关键点】强制关闭本地浏览器连接，触发 Browserless 回收进程空间
        if (localWs) {
            console.log(`[槽位 ${slotId}] 💤 会话结束，释放本地资源。`);
            localWs.close();
            localWs = null;
        }
        
        // 2秒后重试连接 Server 重新进入“待命”状态
        setTimeout(() => startSlot(slotId), 2000);
    };

    serverWs.onerror = () => {
        console.error(`[槽位 ${slotId}] ⚠️ 网络连接异常`);
    };
}