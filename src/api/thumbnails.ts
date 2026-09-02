import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

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
  const imageData = await file.arrayBuffer();
  const imageBuffer = Buffer.from(imageData);
  const image64 = imageBuffer.toString("base64");
  const dataURL = `data:${fileType};base64,${image64}`;
  
  let video = getVideo(cfg.db, videoId);

  if (video?.userID != userID)
    throw new UserForbiddenError("Video is not available");

  video.thumbnailURL = dataURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, JSON.stringify(video));
}
