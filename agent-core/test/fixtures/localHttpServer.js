// WHATWG Fetch blocked ports, checked against this Node runtime's bundled Undici.
// A successful OS listen(0) does not imply that fetch is allowed to use the port.
export const FETCH_BAD_PORTS = new Set([
  1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,
  109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,
  526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,
  3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080,
]);

export async function closeLocalHttpServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

export async function listenLocalHttpServer(server, { onRejectedPort = port =>
  process.stderr.write(`[localHttpServer] rejected fetch bad port ${port}; requesting another random port\n`) } = {}) {
  for(let attempt=0;attempt<100;attempt++) {
    await new Promise((resolve,reject)=>{
      const failed=error=>{server.removeListener('listening',ready);reject(error);};
      const ready=()=>{server.removeListener('error',failed);resolve();};
      server.once('error',failed);server.once('listening',ready);
      server.listen(0,'127.0.0.1');
    });
    const port=server.address().port;
    if (!FETCH_BAD_PORTS.has(port)) return `http://127.0.0.1:${port}`;
    await closeLocalHttpServer(server);
    onRejectedPort(port);
  }
  throw new Error('Unable to allocate a fetch-compatible random localhost port after 100 attempts');
}
