// Any visitor's page calls this every ~20s. It makes a game call only when the one-a-minute slot is free.
const { tick } = require("../lib/jobs");
module.exports = async (req, res) => { res.setHeader("cache-control", "no-store"); res.json(await tick()); };
