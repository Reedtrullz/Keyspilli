import { createServer, request } from "node:http";

const listenPort = Number(process.env.KEYSPILLI_PROXY_PORT ?? 3200);
const targetPort = Number(process.env.KEYSPILLI_PROXY_TARGET_PORT ?? 3201);

const server = createServer((incoming, outgoing) => {
  const publicHost = incoming.headers.host ?? `127.0.0.1:${listenPort}`;
  const upstream = request({
    hostname: "127.0.0.1",
    port: targetPort,
    path: incoming.url,
    method: incoming.method,
    headers: {
      ...incoming.headers,
      host: `internal-web:${targetPort}`,
      "x-forwarded-host": publicHost,
      "x-forwarded-proto": "http",
    },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end("proxy unavailable");
  });
  incoming.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
