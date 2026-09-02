import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

const MAX_UPLOAD_SIZE = 10 << 20;

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const data = await req.formData();
  const file = data.get("thumbnail");
  
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }
  
  const fileType = file.type;

  if (fileType != "image/jpeg" && fileType != "image/png")
    throw new BadRequestError("Invalid file type");

  const fileExtension = fileType.split("/")[1];
  const videoName = randomBytes(32).toString("base64url");
  const fileName = `${videoName}.${fileExtension}`;
  const savePath = path.join(cfg.assetsRoot, fileName);
  Bun.write(savePath, file);
  
  let video = getVideo(cfg.db, videoId);

  if (video?.userID != userID)
    throw new UserForbiddenError("Video is not available");

  const videoURL = `http://localhost:${cfg.port}/${savePath}`;
  video.thumbnailURL = videoURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, JSON.stringify(video));
}
