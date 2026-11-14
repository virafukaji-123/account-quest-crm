// The game's MCP endpoint. The token lives in an environment variable on the server only.
const MCP = process.env.AQ_MCP_URL || "https://questathon.aihackerscollective.com/api/public/mcp";

async function callTool(name, args = {}) {
  if (!process.env.AQ_TOKEN) throw new Error("AQ_TOKEN is not set on the server");
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${process.env.AQ_TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  });
  let body = await res.text();
  if (body.includes("data:")) { const d = body.split("\n").filter((l) => l.startsWith("data:")); if (d.length) body = d[d.length - 1].slice(5).trim(); }
  let json; try { json = JSON.parse(body); } catch { throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`); }
  const { result, error } = json;
  if (error) throw new Error(error.message || "Game error");
  if (result?.isError) throw new Error(result.content?.[0]?.text || "Tool error");
  const text = result?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return text; }
}
module.exports = { callTool };
