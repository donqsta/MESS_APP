const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PRIV_KEY = fs.readFileSync(path.join(os.homedir(), ".ssh", "coolify_server"));

const CMD = "docker logs fxb3996e726vc8tznatswenl-065312042094 --tail 80 2>&1";

const conn = new Client();
conn.on("ready", () => {
  conn.exec(CMD, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream
      .on("close", () => conn.end())
      .on("data", (d) => process.stdout.write(d.toString()))
      .stderr.on("data", (d) => process.stderr.write(d.toString()));
  });
}).on("error", (e) => console.error("SSH Error:", e.message))
  .connect({ host: "45.76.189.147", port: 22, username: "root", privateKey: PRIV_KEY, readyTimeout: 15000 });
