/** Decode a known final frame without making assumptions about the media's start time. */
import { execFileSync } from "node:child_process"

export const lastVideoFrame = (file: string, frameCount: number): Buffer =>
  execFileSync(process.env["STRIDER_FFMPEG"]!, [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `select=eq(n\\,${frameCount - 1})`,
    "-fps_mode",
    "passthrough",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1"
  ], { maxBuffer: 2_000_000 })
