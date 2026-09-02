import { respondWithJSON } from "./json";
import { cfg, type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import path from "path";

const MAX_UPLOAD_LIMIT = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) throw new BadRequestError("Invalid video ID");

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  let video = getVideo(cfg.db, videoId);

  if (!video) throw new NotFoundError("Video not found");

  if (video?.userID != userID)
    throw new UserForbiddenError("Video is not available");

  const videoData = await req.formData();
  const file = videoData.get("video");

  if (!(file instanceof File))
    throw new BadRequestError("Video file is missing");

  if (file.size > MAX_UPLOAD_LIMIT)
    throw new BadRequestError("Video file is too large");

  const fileType = file.type;
  if (fileType !== "video/mp4") throw new BadRequestError("Invalid file type");

  const videoName = `${videoId}.mp4`;
  const videoPath = path.join(cfg.assetsRoot, videoName);
  await Bun.write(videoPath, file);
  const savePath = await processVideoForFastStart(videoPath);
  const aspectRatio = await getVideoAspectRatio(savePath);
  const deletable = Bun.file(savePath);

  video.videoURL = `${aspectRatio}/${videoName}`;
  updateVideo(cfg.db, video);

  const s3file = cfg.s3Client.file(video.videoURL);
  await s3file.write(deletable, { type: fileType });

  deletable.delete();

  return respondWithJSON(200, null);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      `stream=width,height`,
      "-of",
      "json",
      filePath,
    ],
    {
      stderr: "pipe",
    },
  );

  if ((await proc.exited) !== 0) throw new Error("Command failed");

  const output = await new Response(proc.stdout).text();
  const width = JSON.parse(output).stream_groups[0].streams[0].width;
  const height = JSON.parse(output).stream_groups[0].streams[0].height;

  if (Math.floor(width / height) === Math.floor(16 / 9)) return "landscape";
  else if (Math.floor(width / height) === Math.floor(9 / 16)) return "portrait";
  else return "other";
}

export async function processVideoForFastStart(inputFilePath: string) {
  const outputPath = `${inputFilePath.split(".mp4")[0]}.processed.mp4`;
  const proc = Bun.spawn([
    "ffmpeg",
    "-i",
    inputFilePath,
    "-movflags",
    "faststart",
    "-map_metadata",
    "0",
    "-codec",
    "copy",
    "-f",
    "mp4",
    outputPath,
  ]);

  if ((await proc.exited) !== 0) throw new Error("Command failed");

  return outputPath;
}

export async function generatePresignedURL(
  cfg: ApiConfig,
  key: string,
  expireTime: number,
) {
  return cfg.s3Client.presign(key, { expiresIn: expireTime });
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) return video;

  const signed = await generatePresignedURL(cfg, video.videoURL, 300);
  return { ...video, videoURL: signed };
}
