// 合成一条片子的配乐：node audio/build.mjs overview → out/overview.wav
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const film = process.argv[2] || "overview";
const { default: score } = await import(`./${film}.score.mjs`);
const { wav, rms } = score();
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out", `${film}.wav`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, wav);
console.log(`配乐：${out}（${((wav.length - 44) / 4 / 44100).toFixed(1)} 秒，平均响度 ${(20 * Math.log10(rms)).toFixed(1)} dBFS）`);
