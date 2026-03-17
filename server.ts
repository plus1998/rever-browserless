/**
 * Browserless 中心调度服务器 (Bun 版)
 * 功能：
 * 1. 接收本地 Client 的槽位注册并入池。
 * 2. 接收用户 Puppeteer 的连接请求并分配槽位。
 * 3. 实现双向数据透传与会话清理。
 */

type SocketType = "CLIENT_SLOT" | "USER_REQUEST";
type SessionSocket = Bun.ServerWebSocket<{ type: SocketType }>;

// 存储“空闲待命”的 Client WebSocket 实例
const availableSlots: SessionSocket[] = [];

// 存储正在进行的会话映射 (User WS <-> Client WS)
const activeSessions = new Map<SessionSocket, SessionSocket>();

const PORT = Number(process.env.PORT ?? "8080");
const rawAuthToken = process.env.TOKEN;

if (!rawAuthToken) {
  throw new Error("❌ 环境缺失: 必须设置 TOKEN");
}

const serverAuthToken = rawAuthToken;

function hasValidToken(url: URL) {
  return url.searchParams.get("token") === serverAuthToken;
}

console.log(`
=================================================
🏰 Browserless 中心调度服务器已启动
=================================================
监听端口: ${PORT}
注册接口: ws://YOUR_IP:${PORT}/register?token=YOUR_TOKEN
用户接口: ws://YOUR_IP:${PORT}/puppeteer?token=YOUR_TOKEN
=================================================
`);

Bun.serve<{ type: SocketType }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/register" || url.pathname === "/puppeteer") {
      if (!hasValidToken(url)) {
        console.log(`[拒绝访问] ${url.pathname} token 校验失败`);
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // 1. 本地 Client 注册路由
    if (url.pathname === "/register") {
      const success = server.upgrade(req, { data: { type: "CLIENT_SLOT" } });
      return success ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    // 2. 用户 Puppeteer 连接路由
    if (url.pathname === "/puppeteer") {
      const success = server.upgrade(req, { data: { type: "USER_REQUEST" } });
      return success ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    return new Response("Hello Browserless Hub!");
  },

  websocket: {
    // --- 当有新的 WebSocket 连接打开时 ---
    open(ws) {
      if (ws.data.type === "CLIENT_SLOT") {
        // 本地节点的一个槽位连上来了，放入空闲池
        availableSlots.push(ws);
        console.log(`[节点注册] 现有空闲槽位: ${availableSlots.length}`);
      } 
      
      else if (ws.data.type === "USER_REQUEST") {
        // 用户 Puppeteer 连上来了，尝试分配槽位
        const clientWs = availableSlots.shift(); // 弹出一个最先注册的槽位

        if (!clientWs) {
          console.log(`[拒绝访问] 当前无可用槽位`);
          ws.close(1013, "No available local slots");
          return;
        }

        // 建立双向绑定关系
        activeSessions.set(ws, clientWs);
        activeSessions.set(clientWs, ws);

        console.log(`[会话开始] 成功匹配槽位。剩余空闲: ${availableSlots.length}`);
      }
    },

    // --- 核心逻辑：流量双向透传 ---
    message(ws, message) {
      const target = activeSessions.get(ws);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(message);
      }
    },

    // --- 当连接断开时 (清理工作) ---
    close(ws) {
      if (ws.data.type === "CLIENT_SLOT") {
        // 如果这个槽位在空闲池里，直接移除
        const index = availableSlots.indexOf(ws);
        if (index !== -1) {
          availableSlots.splice(index, 1);
          console.log(`[节点离线] 剩余空闲槽位: ${availableSlots.length}`);
        }
      }

      // 处理正在进行的会话清理
      const peerWs = activeSessions.get(ws);
      if (peerWs) {
        // 1. 断开配对方的连接 (触发 Client 端的资源回收)
        peerWs.close();
        
        // 2. 移除映射关系
        activeSessions.delete(ws);
        activeSessions.delete(peerWs);
        
        console.log(`[会话结束] 资源已释放`);
      }
    }
  },
});