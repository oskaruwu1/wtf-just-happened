import http from "node:http";

const PORT = 3000;

console.log(`Starting primary server on port ${PORT}...`);
const server1 = http.createServer((_req, res) => {
  res.writeHead(200);
  res.end("OK");
});

server1.listen(PORT, () => {
  console.log(`Server 1 successfully listening on http://localhost:${PORT}`);
  console.log(`Attempting to bind a second server on duplicate port ${PORT}...`);

  const server2 = http.createServer();
  server2.on("error", (err) => {
    console.error(`\nFatal Server Collision Error:\n`, err.stack || err);
    console.error(`Port ${PORT} is already allocated by another process!`);
    server1.close(() => {
      process.exit(1);
    });
  });

  server2.listen(PORT);
});
