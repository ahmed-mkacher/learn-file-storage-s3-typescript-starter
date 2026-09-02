import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "path";

const MAX_UPLOAD_LIMIT = 1 << 30;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) throw new BadRequestError("Invalid video ID");

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  let video = getVideo(cfg.db, videoId);

  if (video?.userID != userID)
    throw new UserForbiddenError("Video is not available");

  const videoData = await req.formData();
  const file = videoData.get("video");

  if (!(file instanceof File))
    throw new BadRequestError("Video file is missing");

  if (file.size > MAX_UPLOAD_LIMIT)
    throw new BadRequestError("Video file is too large");

  const fileType = file.type;
  if (fileType != "video/mp4") throw new BadRequestError("Invalid file type");

  const videoName = `${videoId}.mp4`;
  const savePath = path.join(cfg.assetsRoot, videoName);
  await Bun.write(savePath, file);
  const deletable = Bun.file(savePath);

  const s3file = cfg.s3Client.file(videoName);
  await s3file.write(deletable, { type: fileType });

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoName}`;
  updateVideo(cfg.db, video);

  await deletable.delete();

  return respondWithJSON(200, null);
}
