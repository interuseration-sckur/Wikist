const { createWikistServer } = require("./src/server/app");

const port = Number(process.env.WIKIST_PORT || 8899);
const host = process.env.WIKIST_HOST || "127.0.0.1";

const server = createWikistServer({
  rootDir: __dirname,
});

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`无法监听 http://${host}:${port}。该端口已被占用；请使用 run-wikist-server.cmd --restart 重启已有 Wikist，或先停止占用进程。`);
    process.exit(1);
    return;
  }
  if (error.code === "EACCES") {
    console.error(`没有权限监听 http://${host}:${port}。请换用大于 1024 的端口，或调整权限。`);
    process.exit(1);
    return;
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Wikist is running at http://${host}:${port}`);
});
